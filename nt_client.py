from __future__ import annotations

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

from networktables import NetworkTablesInstance


DEFAULT_TEAM = 1234
NT_PORT = 1735
# NetworkTables retries on its own; only tear the client down after it has had
# time to resolve the host and finish the initial sync.
CLIENT_RESTART_GRACE_S = 6.0
BRIDGE_CONFIG_PATH = Path.home() / ".hotloop" / "bridge_connection.json"


def load_team_number() -> int:
    env_team = os.getenv("FRC_TEAM")
    if env_team and env_team.isdigit():
        return int(env_team)

    candidates = [
        Path.cwd() / ".wpilib" / "wpilib_preferences.json",
        Path(__file__).resolve().parent / ".wpilib" / "wpilib_preferences.json",
        Path.home() / ".wpilib" / "wpilib_preferences.json",
    ]

    for path in candidates:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            team = data.get("teamNumber")
            if isinstance(team, int):
                return team
        except Exception:
            pass

    return DEFAULT_TEAM


def load_bridge_connection_config() -> dict[str, Any]:
    try:
        if BRIDGE_CONFIG_PATH.exists():
            return json.loads(BRIDGE_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def save_bridge_connection_config(config: dict[str, Any]) -> None:
    try:
        BRIDGE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        BRIDGE_CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")
    except Exception:
        pass


def team_to_ip_prefix(team: int) -> str:
    return f"10.{team // 100}.{team % 100}"


def dedupe_hosts(hosts: list[str]) -> list[str]:
    deduped = []
    seen = set()
    for host in hosts:
        if host not in seen:
            seen.add(host)
            deduped.append(host)
    return deduped


def expand_host_aliases(host: str, port: int = NT_PORT) -> list[str]:
    normalized_host = str(host).strip()
    if not normalized_host:
        return []

    # Resolved IPv4 first: handing NetworkTables an address avoids a fresh mDNS
    # lookup (~1 s for .local names) on every connection attempt.
    ipv4_aliases: list[str] = []
    other_aliases: list[str] = []

    try:
        for result in socket.getaddrinfo(normalized_host, port, type=socket.SOCK_STREAM):
            resolved_host = str(result[4][0]).strip()
            if not resolved_host:
                continue
            if result[0] == socket.AF_INET:
                ipv4_aliases.append(resolved_host)
            else:
                other_aliases.append(resolved_host)
    except OSError:
        pass

    return dedupe_hosts([*ipv4_aliases, normalized_host, *other_aliases])


def candidate_hosts(team: int, manual_host: str | None = None) -> list[str]:
    prefix = team_to_ip_prefix(team)
    hosts: list[str] = []

    if manual_host is None:
        manual_host = os.getenv("ROBOT_HOST")
    if manual_host:
        hosts.extend(expand_host_aliases(manual_host))

    hosts.extend(
        [
            f"roborio-{team}-frc.local",
            f"{prefix}.2",
            f"{prefix}.11",
            "vmxpi.local",
            "raspberrypi.local",
            "localhost",
            "127.0.0.1",
        ]
    )

    return dedupe_hosts(hosts)


def first_reachable_host(
    hosts: list[str],
    port: int = NT_PORT,
    timeout: float = 0.35,
) -> str | None:
    for host in hosts:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return host
        except OSError:
            continue
    return None


class NTClient:
    def __init__(self, team: int):
        config = load_bridge_connection_config()
        configured_team = config.get("teamNumber")
        self.team = configured_team if isinstance(configured_team, int) and configured_team > 0 else team
        self.inst = NetworkTablesInstance.getDefault()
        self.sd = self.inst.getTable("SmartDashboard")
        self.connection_mode = "team-auto"
        self.connection_target = f"team {self.team}"
        self.connected_host = "unknown"
        env_manual_host = os.getenv("ROBOT_HOST")
        configured_manual_host = config.get("manualHost")
        self.manual_host = str(env_manual_host or configured_manual_host or "").strip() or None
        configured_preference = str(config.get("connectionPreference", "")).strip().lower()
        if configured_preference == "manual-host" and self.manual_host:
            self.connection_preference = "manual-host"
        else:
            self.connection_preference = "team-auto"
        self._lock = threading.Lock()
        self._client_started_at = 0.0

        with self._lock:
            self._start_client_locked()

        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()

    def _persist_connection_config(self) -> None:
        save_bridge_connection_config(
            {
                "teamNumber": self.team,
                "manualHost": self.manual_host,
                "connectionPreference": self.connection_preference,
            }
        )

    def _stop_client_locked(self) -> None:
        stop_client = getattr(self.inst, "stopClient", None)
        if callable(stop_client):
            try:
                stop_client()
            except Exception:
                pass

    def _start_client_locked(self) -> None:
        self._stop_client_locked()
        self._client_started_at = time.monotonic()

        if self.connection_preference == "manual-host" and self.manual_host:
            start_client = getattr(self.inst, "startClient", None)
            host_candidates = expand_host_aliases(self.manual_host)
            target_host = first_reachable_host(host_candidates) or host_candidates[0]
            self.connection_mode = "manual-fallback"
            self.connection_target = self.manual_host
            self.connected_host = target_host
            if callable(start_client):
                start_client(target_host)
            return

        hosts = candidate_hosts(self.team)

        start_client_team = getattr(self.inst, "startClientTeam", None)
        start_ds = getattr(self.inst, "startDSClient", None)

        if callable(start_client_team):
            self.connection_mode = "team-auto"
            self.connection_target = f"team {self.team}"
            self.connected_host = "unknown"
            start_client_team(self.team)
            if callable(start_ds):
                start_ds()
            return

        host = first_reachable_host(hosts) or hosts[0]
        self.connection_mode = "manual-fallback"
        self.connection_target = host
        self.connected_host = host
        start_client = getattr(self.inst, "startClient", None)

        if callable(start_client):
            start_client(host)

    def reconnect(self) -> None:
        with self._lock:
            self._start_client_locked()

    def get_connection_settings(self) -> dict[str, Any]:
        return {
            "teamNumber": self.team,
            "manualHost": self.manual_host,
            "connectionPreference": self.connection_preference,
        }

    def update_connection_settings(
        self,
        manual_host: str | None = None,
        connection_preference: str | None = None,
        reconnect: bool = True,
    ) -> dict[str, Any]:
        with self._lock:
            if manual_host is not None:
                self.manual_host = str(manual_host).strip() or None

            if connection_preference in {"team-auto", "manual-host"}:
                if connection_preference == "manual-host" and not self.manual_host:
                    self.connection_preference = "team-auto"
                else:
                    self.connection_preference = connection_preference
            elif self.manual_host and self.connection_preference == "manual-host":
                self.connection_preference = "manual-host"

            if self.connection_preference != "manual-host":
                self.manual_host = None

            self._persist_connection_config()

            if reconnect:
                self._start_client_locked()

            return self.get_connection_settings()

    def _monitor_loop(self) -> None:
        while True:
            try:
                connected = self.is_connected()
                in_grace = time.monotonic() - self._client_started_at < CLIENT_RESTART_GRACE_S
                if not connected and not in_grace:
                    with self._lock:
                        if self.connection_preference == "manual-host" and self.manual_host:
                            self.connection_target = self.manual_host
                            self._start_client_locked()
                        elif self.connection_mode == "manual-fallback":
                            host = first_reachable_host(candidate_hosts(self.team))
                            if host and host != self.connection_target:
                                self.connection_target = host
                                self._start_client_locked()
                elif connected:
                    remote_ip = self._active_remote_ip()
                    if remote_ip:
                        self.connected_host = remote_ip
            except Exception:
                pass

            time.sleep(1.0)

    def _active_remote_ip(self) -> str | None:
        try:
            connections = self.inst.getConnections()
        except Exception:
            return None
        for connection in connections or []:
            remote_ip = str(getattr(connection, "remote_ip", "") or "").strip()
            if remote_ip:
                return remote_ip
        return None

    def is_connected(self) -> bool:
        is_connected = getattr(self.inst, "isConnected", None)
        if callable(is_connected):
            try:
                return bool(is_connected())
            except Exception:
                return False
        return False

    def get_string(self, key: str, default: str = "") -> str:
        try:
            return self.sd.getString(key, default)
        except Exception:
            return default

    def get_number(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.sd.getNumber(key, default))
        except Exception:
            return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        try:
            return bool(self.sd.getBoolean(key, default))
        except Exception:
            return default

    def has_key(self, key: str) -> bool:
        try:
            contains_key = getattr(self.sd, "containsKey", None)
            if callable(contains_key):
                return bool(contains_key(key))
        except Exception:
            return False
        return False

    def get_optional_bool(self, key: str) -> bool | None:
        if not self.has_key(key):
            return None
        try:
            return bool(self.sd.getBoolean(key, False))
        except Exception:
            return None

    def get_subtable(self, path: str):
        try:
            table = self.sd
            for segment in path.split("/"):
                if not segment:
                    continue
                table = table.getSubTable(segment)
            return table
        except Exception:
            return None

    def get_table(self, path: str):
        segments = [segment for segment in path.split("/") if segment]
        if not segments:
            return None

        try:
            table = self.inst.getTable(segments[0])
        except Exception:
            return None

        for segment in segments[1:]:
            try:
                table = table.getSubTable(segment)
            except Exception:
                return None

        return table

    def get_table_subtables(self, path: str) -> list[str]:
        table = self.get_table(path)
        if table is None:
            return []

        try:
            return sorted(str(name) for name in table.getSubTables())
        except Exception:
            return []

    def get_table_string(self, path: str, key: str, default: str = "") -> str:
        table = self.get_table(path)
        if table is None:
            return default
        try:
            return table.getString(key, default)
        except Exception:
            return default

    def get_table_string_array(self, path: str, key: str, default: list[str] | None = None) -> list[str]:
        table = self.get_table(path)
        if table is None:
            return default or []
        try:
            return list(table.getStringArray(key, default or []))
        except Exception:
            return default or []

    def get_table_bool(self, path: str, key: str, default: bool = False) -> bool:
        table = self.get_table(path)
        if table is None:
            return default
        try:
            return bool(table.getBoolean(key, default))
        except Exception:
            return default

    def get_subtable_string(self, path: str, key: str, default: str = "") -> str:
        table = self.get_subtable(path)
        if table is None:
            return default
        try:
            return table.getString(key, default)
        except Exception:
            return default

    def get_subtable_string_array(self, path: str, key: str, default: list[str] | None = None) -> list[str]:
        table = self.get_subtable(path)
        if table is None:
            return default or []
        try:
            return list(table.getStringArray(key, default or []))
        except Exception:
            return default or []

    def put_subtable_string(self, path: str, key: str, value: str) -> bool:
        table = self.get_subtable(path)
        if table is None:
            return False
        try:
            return bool(table.putString(key, value))
        except Exception:
            return False

    def put_number(self, key: str, value: float) -> bool:
        try:
            return bool(self.sd.putNumber(key, value))
        except Exception:
            return False

    def put_bool(self, key: str, value: bool) -> bool:
        try:
            return bool(self.sd.putBoolean(key, value))
        except Exception:
            return False

    def put_string(self, key: str, value: str) -> bool:
        try:
            return bool(self.sd.putString(key, value))
        except Exception:
            return False

    def read_entry(self, key: str) -> dict[str, Any] | None:
        if not key:
            return None

        entry = None
        try:
            entry = self.sd.getEntry(key)
        except Exception:
            entry = None

        try:
            value = self.sd.getValue(key, None)
        except Exception:
            value = None

        if entry is None and value is None:
            return None

        try:
            type_id = int(entry.getType()) if entry is not None else 0
        except Exception:
            type_id = 0

        try:
            persistent = bool(entry.isPersistent()) if entry is not None else False
        except Exception:
            persistent = False

        return {
            "key": key,
            "value": value,
            "typeId": type_id,
            "persistent": persistent,
        }

    def _collect_entries(self, table, prefix: str = "") -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []

        try:
            keys = sorted(str(key) for key in table.getKeys())
        except Exception:
            keys = []

        for key in keys:
            full_key = f"{prefix}/{key}" if prefix else key
            entry = None
            try:
                entry = table.getEntry(key)
            except Exception:
                entry = None

            try:
                value = table.getValue(key, None)
            except Exception:
                value = None

            try:
                type_id = int(entry.getType()) if entry is not None else 0
            except Exception:
                type_id = 0

            try:
                persistent = bool(entry.isPersistent()) if entry is not None else False
            except Exception:
                persistent = False

            entries.append(
                {
                    "key": full_key,
                    "value": value,
                    "typeId": type_id,
                    "persistent": persistent,
                }
            )

        try:
            subtables = sorted(str(name) for name in table.getSubTables())
        except Exception:
            subtables = []

        for subtable_name in subtables:
            try:
                subtable = table.getSubTable(subtable_name)
            except Exception:
                continue

            if subtable is None:
                continue

            child_prefix = f"{prefix}/{subtable_name}" if prefix else subtable_name
            entries.extend(self._collect_entries(subtable, child_prefix))

        return entries

    def get_all_entries(self) -> list[dict[str, Any]]:
        return self._collect_entries(self.sd)
