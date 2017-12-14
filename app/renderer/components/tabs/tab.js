/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this file,
* You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const {StyleSheet, css} = require('aphrodite/no-important')

// Components
const ReduxComponent = require('../reduxComponent')
const Favicon = require('./content/favIcon')
const AudioTabIcon = require('./content/audioTabIcon')
const NewSessionIcon = require('./content/newSessionIcon')
const PrivateIcon = require('./content/privateIcon')
const TabTitle = require('./content/tabTitle')
const CloseTabIcon = require('./content/closeTabIcon')
const {NotificationBarCaret} = require('../main/notificationBar')
const makeDraggableAndDetachable = require('./makeDraggableAndDetachable')

// Actions
const appActions = require('../../../../js/actions/appActions')
const windowActions = require('../../../../js/actions/windowActions')

// Store
const windowStore = require('../../../../js/stores/windowStore')

// State helpers
const privateState = require('../../../common/state/tabContentState/privateState')
const audioState = require('../../../common/state/tabContentState/audioState')
const tabUIState = require('../../../common/state/tabUIState')
const tabState = require('../../../common/state/tabState')

// Styles
const globalStyles = require('../styles/global')
const {theme} = require('../styles/theme')

// Utils
const {getTextColorForBackground} = require('../../../../js/lib/color')
const contextMenus = require('../../../../js/contextMenus')
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const {hasTabAsRelatedTarget} = require('../../lib/tabUtil')
const isWindows = require('../../../common/lib/platformUtil').isWindows()
const {getCurrentWindowId} = require('../../currentWindow')
const {setObserver} = require('../../lib/observerUtil')
const UrlUtil = require('../../../../js/lib/urlutil')

function isTabElement (element) {
  return element && element.getAttribute('data-tab-area')
}

class Tab extends React.Component {
  constructor (props) {
    super(props)
    this.onMouseMove = this.onMouseMove.bind(this)
    this.onMouseEnter = this.onMouseEnter.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
    this.onDragStart = this.onDragStart.bind(this)
    this.onClickTab = this.onClickTab.bind(this)
    this.onObserve = this.onObserve.bind(this)
    this.onTabClosedWithMouse = this.onTabClosedWithMouse.bind(this)
    this.tabNode = null
  }

  get frame () {
    return windowStore.getFrame(this.props.frameKey)
  }

  //
  // Events to dispatch drag operations to store.
  // Only run by source window
  //

  // Setup this tab window instance as the dragging source
  // moving the tab and orchestrating order changes
  // as well as dispatching events to the store so it can
  // handle detach / attach
  // Because this drag event starts in this window's web context,
  // it will receive locations even outside of the window.
  // If we start monitoring mousemove events in another window, it wouldn't
  // get position updates when the mouse moves outside the window, which we need
  // so we use the event instances started from this window to control the movement
  // in any other window the tab may have been dragged to
  onDragStart (e) {
    e.preventDefault()
    // let the store know where on the tab the mouse is, so it can always
    // keep the tab in the same place under the mouse, regardless of which
    // actual element from which window is being moved
    const dragElementBounds = e.target.getBoundingClientRect()
    const relativeXDragStart = e.clientX - dragElementBounds.left
    const relativeYDragStart = e.clientY - dragElementBounds.top
    appActions.tabDragStarted(
      getCurrentWindowId(),
      this.frame,
      this.props.tabId,
      e.clientX,
      e.clientY,
      e.screenX,
      e.screenY,
      dragElementBounds.width,
      dragElementBounds.height,
      relativeXDragStart,
      relativeYDragStart,
      this.props.singleTab
    )
    if (this.frame) {
      // cancel tab preview while dragging. see #10103
      windowActions.setTabHoverState(this.props.frameKey, false, false)
    }
  }

  //
  // General Events
  //

  onMouseLeave (e) {
    if (!this.props.anyTabIsDragging) {
      // mouseleave will keep the previewMode
      // as long as the related target is another tab
      windowActions.setTabHoverState(this.props.frameKey, false, hasTabAsRelatedTarget(e))
    }
  }

  onMouseEnter (e) {
    console.error('tab mouse enter', this.props.frameIndex)
    if (this.props.anyTabIsDragging) {
      // report mouse over a tab that is not in the current window
      // TODO: focus window when dragging and mouseenter the whole window
      const windowId = getCurrentWindowId()
      if (!this.props.isPinned && this.props.dragIntendedWindowId !== windowId) {
        console.log('window tab mouse enter')
        appActions.tabDragMouseOverOtherWindowTab(this.props.frameIndex)
      }
    } else {
      // if mouse entered a tab we only trigger a new preview
      // if user is in previewMode, which is defined by mouse move
      windowActions.setTabHoverState(this.props.frameKey, true, this.props.previewMode)
      // In case there's a tab preview happening, cancel the preview
      // when mouse is over a tab
      windowActions.setTabPageHoverState(this.props.tabPageIndex, false)
    }
  }

  onMouseMove () {
    // dispatch a message to the store so it can delay
    // and preview the tab based on mouse idle time
    if (!this.props.anyTabIsDragging) {
      windowActions.onTabMouseMove(this.props.frameKey)
    }
  }

  onAuxClick (e) {
    this.onClickTab(e)
  }

  onTabClosedWithMouse (event) {
    event.stopPropagation()
    const frame = this.frame

    if (frame && !frame.isEmpty()) {
      const tabWidth = this.fixTabWidth
      windowActions.onTabClosedWithMouse({
        fixTabWidth: tabWidth
      })
      appActions.tabCloseRequested(this.props.tabId)
    }
  }

  onClickTab (e) {
    switch (e.button) {
      case 2:
        // Ignore right click
        return
      case 1:
        // Close tab with middle click
        this.onTabClosedWithMouse(e)
        break
      default:
        e.stopPropagation()
        appActions.tabActivateRequested(this.props.tabId)
    }
  }

  onObserve (entries) {
    if (this.props.isPinnedTab) {
      return
    }
    // we only have one entry
    const entry = entries[0]
    windowActions.setTabIntersectionState(this.props.frameKey, entry.intersectionRatio)
  }

  get fixTabWidth () {
    if (!this.tabNode) {
      return 0
    }

    const rect = this.elementRef.getBoundingClientRect()
    return rect && rect.width
  }

  //
  // React lifecycle events
  //

  componentDidMount () {
    // unobserve tabs that we don't need. This will
    // likely be made by onObserve method but added again as
    // just to double-check
    if (this.props.isPinned) {
      this.observer && this.observer.unobserve(this.tabSentinel)
    }
    const threshold = Object.values(globalStyles.intersection)
    // At this moment Chrome can't handle unitless zeroes for rootMargin
    // see https://github.com/w3c/IntersectionObserver/issues/244
    const margin = '0px'
    this.observer = setObserver(this.tabSentinel, threshold, margin, this.onObserve)
    this.observer.observe(this.tabSentinel)

    this.tabNode.addEventListener('auxclick', this.onAuxClick.bind(this))
  }

  componentWillUnmount () {
    this.observer.unobserve(this.tabSentinel)
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const frame = ownProps.frame
    const frameKey = frame.get('key')
    const tabId = frame.get('tabId', tabState.TAB_ID_NONE)
    const isPinned = tabState.isTabPinned(state, tabId)
    const partOfFullPageSet = ownProps.partOfFullPageSet

    // TODO: this should have its own method
    const notifications = state.get('notifications')
    const notificationOrigins = notifications ? notifications.map(bar => bar.get('frameOrigin')) : false
    const notificationBarActive = frame.get('location') && notificationOrigins &&
      notificationOrigins.includes(UrlUtil.getUrlOrigin(frame.get('location')))

    const props = {}
    props.dragElementRef = ownProps.dragElementRef
    // TODO: this should have its own method
    props.notificationBarActive = notificationBarActive
    props.frameKey = frameKey
    props.isEmpty = frame.isEmpty()
    props.isPinnedTab = isPinned
    props.isPrivateTab = privateState.isPrivateTab(currentWindow, frameKey)
    props.isActive = frameStateUtil.isFrameKeyActive(currentWindow, frameKey)
    props.tabWidth = currentWindow.getIn(['ui', 'tabs', 'fixTabWidth'])
    props.themeColor = tabUIState.getThemeColor(currentWindow, frameKey)
    props.displayIndex = ownProps.displayIndex
    props.displayedTabCount = ownProps.displayedTabCount
    props.totalTabCount = ownProps.totalTabCount || ownProps.displayedTabCount
    props.title = frame.get('title')
    props.tabPageIndex = frameStateUtil.getTabPageIndex(currentWindow)
    props.partOfFullPageSet = partOfFullPageSet
    props.showAudioTopBorder = audioState.showAudioTopBorder(currentWindow, frameKey, isPinned)
    props.centralizeTabIcons = tabUIState.centralizeTabIcons(currentWindow, frameKey, isPinned)
    props.firstTabDisplayIndex = ownProps.firstTabDisplayIndex != null ? ownProps.firstTabDisplayIndex : 0
    props.tabPageIndex = ownProps.tabPageIndex
    // used in other functions
    props.tabId = tabId
    props.previewMode = currentWindow.getIn(['ui', 'tabs', 'previewMode'])
    props.frameIndex = frame.get('index')
    // drag related
    const dragSourceData = state.get('tabDragData')
    props.anyTabIsDragging = dragSourceData || false
    props.dragIntendedWindowId = dragSourceData ? dragSourceData.get('currentWindowId') : null
    // needs to know if window will be destroyed when tab is detached
    props.singleTab = ownProps.singleTab
    const windowId = getCurrentWindowId()
    if (
      dragSourceData &&
      tabState.isTabDragging(state, tabId)
    ) {
      // make sure we're setup
      props.isDragging = true
      props.tabWidth = dragSourceData.get('tabWidth')
      props.dragOriginatedThisWindow = dragSourceData.get('originalWindowId') === windowId
      props.draggingDisplayIndexRequested = dragSourceData.get('displayIndexRequested')
      props.dragSingleTab = ownProps.singleTab
      // TODO: this is probably not needed anymore, but did prevent some crashes previously
      props.dragProcessMoves =
        !dragSourceData.has('attachRequestedWindowId') &&
        !dragSourceData.has('detachedFromWindowId') &&
        props.dragIntendedWindowId === windowId &&
        tabState.getWindowId(state, tabId) === windowId
      props.dragCanDetach = !props.isPinnedTab
      props.relativeXDragStart = dragSourceData.get('relativeXDragStart')
      props.dragWindowClientX = dragSourceData.get('dragWindowClientX')
      props.dragWindowClientY = dragSourceData.get('dragWindowClientY')
      props.detachedFromTabX = dragSourceData.get('detachedFromTabX')
    } else {
      props.isDragging = false
      props.relativeXDragStart = null
      props.draggingDisplayIndexRequested = null
      props.dragOriginatedThisWindow = false
      props.dragProcessMoves = false
    }
    return props
  }

  componentWillReceiveProps (nextProps) {
    if (this.props.tabWidth && !nextProps.tabWidth) {
      // remember the width so we can transition from it
      this.originalWidth = this.elementRef.getBoundingClientRect().width
    }
  }

  componentDidUpdate (prevProps) {
    if (!this.elementRef) {
      return
    }
    // animate tab width if it changes due to a
    // removal of a restriction when performing
    // multiple tab-closes in a row
    if (prevProps.tabWidth && !this.props.tabWidth) {
      window.requestAnimationFrame(() => {
        const newWidth = this.elementRef.getBoundingClientRect().width
        this.elementRef.animate([
          { flexBasis: `${this.originalWidth}px`, flexGrow: 0, flexShrink: 0 },
          { flexBasis: `${newWidth}px`, flexGrow: 0, flexShrink: 0 }
        ], {
          duration: 250,
          iterations: 1,
          easing: 'ease-in-out'
        })
      })
    }
  }

  captureRef (element) {
    this.elementRef = element
    this.props.dragElementRef(element)
  }

  render () {
    // we don't want themeColor if tab is private
    const isThemed = !this.props.isPrivateTab && this.props.isActive && this.props.themeColor
    const instanceStyles = { }
    if (isThemed) {
      instanceStyles['--theme-color-fg'] = getTextColorForBackground(this.props.themeColor)
      instanceStyles['--theme-color-bg'] = this.props.themeColor
    }
    return <div
      data-tab-area
      data-frame-index={this.props.frameIndex}
      data-display-index={this.props.displayIndex}
      data-prevent-transitions={this.props.isDragging}
      data-is-dragging={this.props.isDragging}
      className={css(
        styles.tabArea,
        this.props.isDragging && styles.tabArea_isDragging,
        this.props.isPinnedTab && styles.tabArea_isPinned,
        this.props.isActive && styles.tabArea_isActive,
        (this.props.partOfFullPageSet || !!this.props.tabWidth) && styles.tabArea_partOfFullPageSet
      )}
      style={this.props.tabWidth && !this.props.isPinnedTab ? { flex: `0 0 ${this.props.tabWidth}px` } : {}}
      onMouseMove={this.onMouseMove}
      onMouseEnter={this.onMouseEnter}
      onMouseLeave={this.onMouseLeave}
      data-test-id='tab-area'
      data-frame-key={this.props.frameKey}
      data-tab-id={this.props.tabId}
      ref={this.captureRef.bind(this)}
      >
      {
        this.props.isActive && this.props.notificationBarActive
          ? <NotificationBarCaret />
          : null
      }
      <div
        data-tab
        ref={(node) => { this.tabNode = node }}
        className={css(
          styles.tabArea__tab,
          // tab icon only (on pinned tab / small tab)
          this.props.isPinnedTab && styles.tabArea__tab_pinned,
          this.props.centralizeTabIcons && styles.tabArea__tab_centered,
          this.props.showAudioTopBorder && styles.tabArea__tab_audioTopBorder,
          // Windows specific style (color)
          isWindows && styles.tabArea__tab_forWindows,
          // Set background-color and color to active tab and private tab
          this.props.isActive && styles.tabArea__tab_active,
          this.props.isPrivateTab && styles.tabArea__tab_private,
          (this.props.isPrivateTab && this.props.isActive) && styles.tabArea__tab_private_active,
          this.props.isEmpty && styles.tabArea__tab_empty,
          // Apply themeColor if tab is active and not private
          isThemed && styles.tabArea__tab_themed
        )}
        style={instanceStyles}
        data-test-id='tab'
        data-test-active-tab={this.props.isActive}
        data-test-pinned-tab={this.props.isPinnedTab}
        data-test-private-tab={this.props.isPrivateTab}
        data-frame-key={this.props.frameKey}
        draggable
        data-draggable-tab
        title={this.props.title}
        onDragStart={this.onDragStart}
        onClick={this.onClickTab}
        onContextMenu={contextMenus.onTabContextMenu.bind(this, this.frame)}
      >
        <div
          ref={(node) => { this.tabSentinel = node }}
          className={css(styles.tabArea__tab__sentinel)}
        />
        <div className={css(
          styles.tabArea__tab__identity,
          this.props.centralizeTabIcons && styles.tabArea__tab__identity_centered
        )}>
          <Favicon tabId={this.props.tabId} />
          <AudioTabIcon tabId={this.props.tabId} />
          <TabTitle tabId={this.props.tabId} />
        </div>
        <PrivateIcon tabId={this.props.tabId} />
        <NewSessionIcon tabId={this.props.tabId} />
        <CloseTabIcon tabId={this.props.tabId} onClick={this.onTabClosedWithMouse} />
      </div>
    </div>
  }
}

const styles = StyleSheet.create({
  tabArea: {
    // TODO: add will-change when any tab is being dragged, making it ready for animate, but dont do it always
    willChange: 'transform',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
    flex: 1,
    bottom: 0, // when tab disappears, it gets absolute positioning and a top, left, right but no bottom

    // add a border but hide it with negative margin so that it shows when tab is appearing / disappearing
    borderWidth: '1px 1px 1px 1px',
    backgroundColor: '#ddd',
    margin: '-1px 0 0 -1px',
    borderStyle: 'solid',
    borderColor: '#bbb',
    zIndex: 100,

    // no-drag is applied to the button and tab area
    // ref: tabs__tabStrip__newTabButton on tabs.js
    WebkitAppRegion: 'no-drag',

    // There's a special case that tabs should span the full width
    // if there are a full set of them.
    maxWidth: '184px'
  },

  tabArea_isDragging: {
    transform: 'translateX(var(--dragging-delta-x))',
    zIndex: 200
  },

  tabArea_isActive: {
    zIndex: 300,
    borderBottomWidth: 0
  },

  tabArea_isPinned: {
    flex: 'initial'
  },

  tabArea_partOfFullPageSet: {
    maxWidth: 'initial'
  },

  tabArea__tab: {
    boxSizing: 'border-box',
    color: theme.tab.color,
    display: 'flex',
    transition: theme.tab.transition,
    height: '100%',
    width: '-webkit-fill-available',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',

    ':hover': {
      background: theme.tab.hover.background
    }
  },

  tabArea__tab_audioTopBorder: {
    '::before': {
      zIndex: globalStyles.zindex.zindexTabsAudioTopBorder,
      content: `''`,
      display: 'block',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '2px',
      background: 'lightskyblue'
    }
  },

  tabArea__tab_isDragging: {

  },

  tabArea__tab_pinned: {
    padding: 0,
    width: '28px',
    justifyContent: 'center'
  },

  tabArea__tab_centered: {
    flex: 'auto',
    justifyContent: 'center',
    padding: 0,
    margin: 0
  },

  // Windows specific style
  tabArea__tab_forWindows: {
    color: theme.tab.forWindows.color
  },

  tabArea__tab_active: {
    background: theme.tab.active.background,
    paddingBottom: '1px',
    ':hover': {
      background: theme.tab.active.background
    }
  },

  tabArea__tab_private: {
    background: theme.tab.private.background,

    ':hover': {
      color: theme.tab.active.private.color,
      background: theme.tab.active.private.background
    }
  },

  tabArea__tab_private_active: {
    background: theme.tab.active.private.background,
    color: theme.tab.active.private.color,

    ':hover': {
      background: theme.tab.active.private.background
    }
  },

  tabArea__tab_themed: {
    color: `var(--theme-color-fg, inherit)`,
    background: `var(--theme-color-bg, inherit)`,

    ':hover': {
      color: `var(--theme-color-fg, inherit)`,
      background: `var(--theme-color-bg, inherit)`
    }
  },

  tabArea__tab_empty: {
    background: 'white'
  },

  // The sentinel is responsible to respond to tabs
  // intersection state. This is an empty hidden element
  // which `width` value shouldn't be changed unless the intersection
  // point needs to be edited.
  tabArea__tab__sentinel: {
    position: 'absolute',
    left: 0,
    height: '1px',
    background: 'transparent',
    width: globalStyles.spacing.sentinelSize
  },

  tabArea__tab__identity: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    minWidth: '0', // @see https://bugzilla.mozilla.org/show_bug.cgi?id=1108514#c5
    margin: `0 ${globalStyles.spacing.defaultTabMargin}`
  },

  tabArea__tab__identity_centered: {
    justifyContent: 'center',
    flex: 'auto',
    padding: 0,
    margin: 0
  }
})

// connect Tab component to state updates
const ConnectedTab = ReduxComponent.connect(Tab)

// add on drag functionality
const evaluateDraggingTabWidth = (elementRef) => {
  const sibling = isTabElement(elementRef.nextElementSibling)
    ? elementRef.nextElementSibling
    : isTabElement(elementRef.previousElementSibling)
      ? elementRef.previousElementSibling
      : null
  const nonDraggingTabWidth = sibling ? sibling.getBoundingClientRect().width : null
  const draggingTabWidth = elementRef.getBoundingClientRect().width
  // save parent position in order to know where first-tab position is, and also the bounds for detaching
  // this is cached and re-evaluated whenever the drag operation starts (or is attached to a different window)
  // if, for some reason, the parent position can change during a drag operation, then this should be re-evaluated
  // more often
  // but only consider tabs within the parent, allowing us to have non sortable / draggable elements inside the parent
  // ...e.g. buttons
  let tabsSelector = '[data-draggable-tab]'
  const allDraggableTabs = elementRef.parentElement.querySelectorAll(tabsSelector)
  let parentClientRect
  if (allDraggableTabs.length) {
    const firstTab = allDraggableTabs.item(0)
    const lastTab = allDraggableTabs.item(allDraggableTabs.length - 1)
    const firstTabRect = firstTab.getBoundingClientRect()
    const lastTabRect = firstTab === lastTab ? firstTabRect : lastTab.getBoundingClientRect()
    parentClientRect = {
      x: firstTabRect.x,
      y: firstTabRect.y,
      left: firstTabRect.left,
      top: firstTabRect.top,
      width: lastTabRect.x + lastTabRect.width - firstTabRect.x,
      height: firstTabRect.height,
      offsetDifference: firstTabRect.x - elementRef.parentElement.getBoundingClientRect().x,
      windowWidth: document.body.clientWidth
    }
  }
  return {
    draggingTabWidth,
    nonDraggingTabWidth,
    parentClientRect
  }
}
const DraggableTab = makeDraggableAndDetachable(ConnectedTab, evaluateDraggingTabWidth)

// give drag functionality the data from state it needs
const mergeStateToDraggableProps = (state, ownProps) => {
  const frame = ownProps.frame
  const tabId = frame.get('tabId', tabState.TAB_ID_NONE)

  const props = Object.assign({
    onRequestDetach: ownProps.onRequestDetach,
    onDragChangeIndex: ownProps.onDragChangeIndex,
    onDragMoveSingleItem: ownProps.onDragMoveSingleItem,
    displayIndex: ownProps.displayIndex,
    totalTabCount: ownProps.totalTabCount || ownProps.displayedTabCount,
    firstTabDisplayIndex: ownProps.firstTabDisplayIndex != null ? ownProps.firstTabDisplayIndex : 0,
    displayedTabCount: ownProps.displayedTabCount
  }, ownProps)
  // drag-related
  const windowId = getCurrentWindowId()
  const dragSourceData = state.get('tabDragData')
  props.dragIntendedWindowId = dragSourceData ? dragSourceData.get('currentWindowId') : null
  // let's draggable know when the container contents have changed (maybe this item was dragged
  // to another 'page'), so it can re-evaluate any data that has changed
  props.containerKey = ownProps.tabPageIndex
  if (
    dragSourceData &&
    tabState.isTabDragging(state, tabId)
  ) {
    // make sure we're setup
    props.isDragging = true
    props.tabWidth = dragSourceData.get('tabWidth')
    props.dragOriginatedThisWindow = dragSourceData.get('originalWindowId') === windowId
    props.draggingDisplayIndexRequested = dragSourceData.get('displayIndexRequested')
    props.dragSingleTab = ownProps.singleTab
    // TODO: this is probably not needed anymore, but did prevent some crashes previously
    props.dragProcessMoves =
      !dragSourceData.has('attachRequestedWindowId') &&
      !dragSourceData.has('detachedFromWindowId') &&
      props.dragIntendedWindowId === windowId &&
      tabState.getWindowId(state, tabId) === windowId
    props.dragCanDetach = !tabState.isTabPinned(state, tabId)
    props.relativeXDragStart = dragSourceData.get('relativeXDragStart')
    props.dragWindowClientX = dragSourceData.get('dragWindowClientX')
    props.dragWindowClientY = dragSourceData.get('dragWindowClientY')
    props.detachedFromTabX = dragSourceData.get('detachedFromTabX')
  } else {
    props.isDragging = false
    props.relativeXDragStart = null
    props.draggingDisplayIndexRequested = null
    props.dragOriginatedThisWindow = false
    props.dragProcessMoves = false
  }
  return props
}
const ConnectedDraggableTab = ReduxComponent.connect(DraggableTab, mergeStateToDraggableProps)

// export the final wrapped component
module.exports = ConnectedDraggableTab
