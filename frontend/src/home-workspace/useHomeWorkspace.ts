import { useEffect, useMemo, useState } from 'react'
import type { HomeWorkspacePresetId } from './homeWorkspacePresets'
import {
  createDefaultDriveLayoutWidgets,
  createHomeWorkspaceBooleanButtonStarterWidget,
  HOME_WORKSPACE_MAX_PAGES,
  createHomeWorkspaceBooleanStarterWidget,
  createHomeWorkspacePage,
  createHomeWorkspacePresetWidget,
  createHomeWorkspaceWidget,
  isHomeWorkspaceTopicWidget,
  loadHomeWorkspaceState,
  persistHomeWorkspaceState,
  placeWidgetPushingOthers,
  type HomeWorkspaceState,
  type HomeWorkspacePresetWidgetConfig,
  type HomeWorkspaceWidget,
  type HomeWorkspaceWidgetConfig,
  type HomeWorkspaceWidgetRenderer,
} from './homeWorkspaceStore'

interface HomeWorkspaceWidgetPatch {
  config?: Partial<HomeWorkspaceWidgetConfig>
  presetConfig?: Partial<HomeWorkspacePresetWidgetConfig>
  renderer?: HomeWorkspaceWidgetRenderer
  title?: string
  topicKey?: string | null
}

function nextPageTitle(state: HomeWorkspaceState) {
  const numbers = state.pages
    .map((page) => {
      const match = page.title.match(/^Page\s+(\d+)$/i)
      return match ? Number.parseInt(match[1], 10) : 0
    })
    .filter((value) => Number.isFinite(value))

  const nextNumber = numbers.length ? Math.max(...numbers) + 1 : state.pages.length + 1
  return `Page ${nextNumber}`
}

function commitState(
  current: HomeWorkspaceState,
  updater: (state: HomeWorkspaceState) => HomeWorkspaceState,
) {
  const next = updater(current)

  if (next === current) {
    return current
  }

  return {
    ...next,
    lastSavedAt: new Date().toISOString(),
  }
}

function updateActivePageWidgets(
  state: HomeWorkspaceState,
  updater: (widgets: HomeWorkspaceWidget[]) => HomeWorkspaceWidget[],
) {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.id === state.activePageId
        ? {
            ...page,
            widgets: updater(page.widgets),
          }
        : page,
    ),
  }
}

export function useHomeWorkspace() {
  const [workspace, setWorkspace] = useState(loadHomeWorkspaceState)

  useEffect(() => {
    persistHomeWorkspaceState(workspace)
  }, [workspace])

  const activePage = useMemo(() => {
    return workspace.pages.find((page) => page.id === workspace.activePageId) ?? workspace.pages[0]
  }, [workspace.activePageId, workspace.pages])

  const setActivePage = (pageId: string) => {
    setWorkspace((current) =>
      commitState(current, (state) => {
        if (!state.pages.some((page) => page.id === pageId)) {
          return state
        }

        return {
          ...state,
          activePageId: pageId,
        }
      }),
    )
  }

  const renamePage = (pageId: string, title: string) => {
    setWorkspace((current) =>
      commitState(current, (state) => {
        const nextTitle = title.trim() || 'Untitled Page'
        let changed = false

        const pages = state.pages.map((page) => {
          if (page.id !== pageId || page.title === nextTitle) {
            return page
          }

          changed = true
          return {
            ...page,
            title: nextTitle,
          }
        })

        return changed ? { ...state, pages } : state
      }),
    )
  }

  const addPage = () => {
    setWorkspace((current) =>
      commitState(current, (state) => {
        if (state.pages.length >= HOME_WORKSPACE_MAX_PAGES) {
          return state
        }

        const page = createHomeWorkspacePage(nextPageTitle(state))
        return {
          ...state,
          activePageId: page.id,
          pages: [...state.pages, page],
        }
      }),
    )
  }

  const removePage = (pageId: string) => {
    setWorkspace((current) =>
      commitState(current, (state) => {
        if (state.pages.length <= 1 || !state.pages.some((page) => page.id === pageId)) {
          return state
        }

        const pageIndex = state.pages.findIndex((page) => page.id === pageId)
        const nextPages = state.pages.filter((page) => page.id !== pageId)
        const nextActiveId =
          state.activePageId === pageId
            ? nextPages[Math.max(0, pageIndex - 1)]?.id ?? nextPages[0].id
            : state.activePageId

        return {
          ...state,
          activePageId: nextActiveId,
          pages: nextPages,
        }
      }),
    )
  }

  const addTopicWidgetToActivePage = () => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => [...widgets, createHomeWorkspaceWidget(widgets)]),
      ),
    )
  }

  const addBooleanStarterToActivePage = () => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => [...widgets, createHomeWorkspaceBooleanStarterWidget(widgets)]),
      ),
    )
  }

  const addBooleanButtonStarterToActivePage = () => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => [...widgets, createHomeWorkspaceBooleanButtonStarterWidget(widgets)]),
      ),
    )
  }

  const addPresetWidgetToActivePage = (presetId: HomeWorkspacePresetId) => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => [...widgets, createHomeWorkspacePresetWidget(widgets, presetId)]),
      ),
    )
  }

  const removeWidget = (widgetId: string) => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => widgets.filter((widget) => widget.id !== widgetId)),
      ),
    )
  }

  const updateWidget = (widgetId: string, patch: HomeWorkspaceWidgetPatch) => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) =>
          widgets.map((widget) => {
            if (widget.id !== widgetId) {
              return widget
            }

            if (!isHomeWorkspaceTopicWidget(widget)) {
              return {
                ...widget,
                title:
                  typeof patch.title === 'string'
                    ? patch.title.trim().slice(0, 48) || widget.title
                    : widget.title,
                config: patch.presetConfig
                  ? {
                      ...widget.config,
                      ...patch.presetConfig,
                    }
                  : widget.config,
              }
            }

            return {
              ...widget,
              title:
                typeof patch.title === 'string'
                  ? patch.title.trim().slice(0, 48) || widget.title
                  : widget.title,
              topicKey:
                patch.topicKey === null
                  ? null
                  : typeof patch.topicKey === 'string'
                    ? patch.topicKey.trim() || null
                    : widget.topicKey,
              renderer: patch.renderer ?? widget.renderer,
              config: patch.config
                ? {
                    ...widget.config,
                    ...patch.config,
                    decimals:
                      typeof patch.config.decimals === 'number'
                        ? Math.max(0, Math.min(4, Math.round(patch.config.decimals)))
                        : widget.config.decimals,
                  }
                : widget.config,
            }
          }),
        ),
      ),
    )
  }

  const moveWidget = (widgetId: string, x: number, y: number) => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => {
          const target = widgets.find((widget) => widget.id === widgetId)
          if (!target) {
            return widgets
          }

          return placeWidgetPushingOthers(widgets, { ...target, x, y })
        }),
      ),
    )
  }

  const resizeWidget = (widgetId: string, w: number, h: number) => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, (widgets) => {
          const target = widgets.find((widget) => widget.id === widgetId)
          if (!target) {
            return widgets
          }

          return placeWidgetPushingOthers(widgets, { ...target, w, h })
        }),
      ),
    )
  }

  const clearActivePage = () => {
    setWorkspace((current) =>
      commitState(current, (state) =>
        updateActivePageWidgets(state, () => []),
      ),
    )
  }

  const loadDefaultLayoutIntoActivePage = () => {
    setWorkspace((current) =>
      commitState(current, (state) => updateActivePageWidgets(state, () => createDefaultDriveLayoutWidgets())),
    )
  }

  return {
    workspace,
    activePage,
    canAddPage: workspace.pages.length < HOME_WORKSPACE_MAX_PAGES,
    setActivePage,
    renamePage,
    addPage,
    removePage,
    addTopicWidgetToActivePage,
    addBooleanStarterToActivePage,
    addBooleanButtonStarterToActivePage,
    addPresetWidgetToActivePage,
    removeWidget,
    updateWidget,
    moveWidget,
    resizeWidget,
    clearActivePage,
    loadDefaultLayoutIntoActivePage,
  }
}
