/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const Immutable = require('immutable')
const {StyleSheet, css} = require('aphrodite/no-important')

// Components
const ReduxComponent = require('../reduxComponent')
const BrowserButton = require('../common/browserButton')
const LongPressButton = require('../common/longPressButton')
const Tab = require('./tab')
const ListWithTransitions = require('./ListWithTransitions')

// Actions
const appActions = require('../../../../js/actions/appActions')
const windowActions = require('../../../../js/actions/windowActions')

// State
const windowState = require('../../../common/state/windowState')
const tabState = require('../../../common/state//tabState')
const tabDraggingState = require('../../../common/state//tabDraggingState')

// Constants
const dragTypes = require('../../../../js/constants/dragTypes')
const settings = require('../../../../js/constants/settings')

// Utils
const cx = require('../../../../js/lib/classSet')
const contextMenus = require('../../../../js/contextMenus')
const {getCurrentWindowId, isFocused} = require('../../currentWindow')
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const {getSetting} = require('../../../../js/settings')

const globalStyles = require('../styles/global')
const {theme} = require('../styles/theme')

const newTabButton = require('../../../../img/toolbar/newtab_btn.svg')

class Tabs extends React.Component {
  constructor (props) {
    super(props)
    this.onDragOver = this.onDragOver.bind(this)
    this.onDrop = this.onDrop.bind(this)
    this.onPrevPage = this.onPrevPage.bind(this)
    this.onNextPage = this.onNextPage.bind(this)
    this.onNewTabLongPress = this.onNewTabLongPress.bind(this)
    this.onMouseLeave = this.onMouseLeave.bind(this)
  }

  onMouseLeave () {
    if (this.props.fixTabWidth == null) {
      return
    }

    windowActions.onTabMouseLeave({
      fixTabWidth: null
    })
  }

  onPrevPage () {
    if (this.props.tabPageIndex === 0) {
      return
    }

    windowActions.setTabPageIndex(this.props.tabPageIndex - 1)
  }

  onNextPage () {
    if (this.props.tabPageIndex + 1 === this.props.totalPages) {
      return
    }

    windowActions.setTabPageIndex(this.props.tabPageIndex + 1)
  }

  onDrop (e) {
    appActions.dataDropped(getCurrentWindowId())

    if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.items).forEach((item) => {
        if (item.kind === 'string') {
          return appActions.createTabRequested({url: item.type})
        }
      })
    }
  }

  onDragOver (e) {
    let intersection = e.dataTransfer.types.filter((x) => ['Files'].includes(x))
    if (intersection.length > 0) {
      e.dataTransfer.dropEffect = 'copy'
      e.preventDefault()
    }
  }

  newTab () {
    appActions.createTabRequested({})
  }

  onNewTabLongPress (target) {
    contextMenus.onNewTabContextMenu(target)
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const pageIndex = frameStateUtil.getTabPageIndex(currentWindow)
    const tabsPerTabPage = Number(getSetting(settings.TABS_PER_PAGE))
    const startingFrameIndex = pageIndex * tabsPerTabPage
    const unpinnedTabs = frameStateUtil.getNonPinnedFrames(currentWindow) || Immutable.List()
    const currentTabs = unpinnedTabs
      .slice(startingFrameIndex, startingFrameIndex + tabsPerTabPage)
      .filter(tab => tab)
    const totalPages = Math.ceil(unpinnedTabs.size / tabsPerTabPage)
    const activeFrame = frameStateUtil.getActiveFrame(currentWindow) || Immutable.Map()
    const dragData = (state.getIn(['dragData', 'type']) === dragTypes.TAB && state.get('dragData')) || Immutable.Map()

    const props = {}
    // used in renderer
    props.previewTabPageIndex = currentWindow.getIn(['ui', 'tabs', 'previewTabPageIndex'])
    props.currentTabs = currentTabs
    props.partOfFullPageSet = currentTabs.size === tabsPerTabPage
    props.onNextPage = currentTabs.size >= tabsPerTabPage && totalPages > pageIndex + 1
    props.onPreviousPage = pageIndex > 0
    props.shouldAllowWindowDrag = windowState.shouldAllowWindowDrag(state, currentWindow, activeFrame, isFocused(state))

    // tab dragging
    props.draggingTabId = tabState.draggingTabId(state)
    props.pausingToChangePageIndex = tabDraggingState.window.getPausingForPageIndex(currentWindow)

    // used in other functions
    props.firstTabDisplayIndex = startingFrameIndex
    props.fixTabWidth = currentWindow.getIn(['ui', 'tabs', 'fixTabWidth'])
    props.tabPageIndex = currentWindow.getIn(['ui', 'tabs', 'tabPageIndex'])
    props.totalTabCount = unpinnedTabs.size
    props.dragData = dragData
    props.dragWindowId = dragData.get('windowId')
    props.totalPages = totalPages
    return props
  }

  render () {
    const isPreview = this.props.previewTabPageIndex != null
    const displayedTabIndex = this.props.previewTabPageIndex != null ? this.props.previewTabPageIndex : this.props.tabPageIndex
    return <div className={css(styles.tabs)}
      data-test-id='tabs'
      onMouseLeave={this.onMouseLeave}
    >
      {[
        <ListWithTransitions className={css(
            styles.tabs__tabStrip,
            isPreview && styles.tabs__tabStrip_isPreview,
            this.props.shouldAllowWindowDrag && styles.tabs__tabStrip_allowDragging
          )}
          key={displayedTabIndex}
          disableAllAnimations={isPreview}
          data-test-preview-tab={isPreview}
          typeName='span'
          duration={710}
          delay={0}
          staggerDelayBy={0}
          easing='cubic-bezier(0.23, 1, 0.32, 1)'
          enterAnimation={this.props.draggingTabId != null ? null : [
            {
              transform: 'translateY(50%)'
            },
            {
              transform: 'translateY(0)'
            }
          ]}
          leaveAnimation={this.props.draggingTabId != null ? null : [
            {
              transform: 'translateY(0)'
            },
            {
              transform: 'translateY(100%)'
            }
          ]}
          onDragOver={this.onDragOver}
          onDrop={this.onDrop}>
          {
            this.props.onPreviousPage
              ? <BrowserButton
                key='prev'
                iconClass={globalStyles.appIcons.prev}
                size='21px'
                custom={[
                  styles.tabs__tabStrip__navigation,
                  styles.tabs__tabStrip__navigation_prev,
                  this.props.pausingToChangePageIndex === this.props.tabPageIndex - 1 && styles.tabs__tabStrip__navigation_isPausing
                ]}
                onClick={this.onPrevPage}
              />
            : null
          }
          {
            this.props.currentTabs
              .map((frame, tabDisplayIndex) =>
                <Tab
                  key={`tab-${frame.get('tabId')}-${frame.get('key')}`}
                  frame={frame}
                  firstTabDisplayIndex={this.props.firstTabDisplayIndex}
                  displayIndex={tabDisplayIndex + this.props.firstTabDisplayIndex}
                  displayedTabCount={this.props.currentTabs.size}
                  totalTabCount={this.props.totalTabCount}
                  singleTab={this.props.totalTabCount === 1}
                  partOfFullPageSet={this.props.partOfFullPageSet}
                  tabPageIndex={displayedTabIndex}
                />
              )
          }
          {
            this.props.onNextPage
              ? <BrowserButton
                key='next'
                iconClass={globalStyles.appIcons.next}
                size='21px'
                custom={[
                  styles.tabs__tabStrip__navigation,
                  styles.tabs__tabStrip__navigation_next,
                  this.props.pausingToChangePageIndex === this.props.tabPageIndex + 1 && styles.tabs__tabStrip__navigation_isPausing
                ]}
                onClick={this.onNextPage}
                />
              : null
          }
          <div
            key='add'
            className={css(
              styles.tabs__postTabButtons,
              this.props.draggingTabId != null && styles.tabs__postTabButtons_isInvisible
            )}
            ListWithTransitionsPreventMoveRight>
            <LongPressButton
              className={cx({
                browserButton: true,
                navbutton: true,
                [css(styles.tabs__tabStrip__newTabButton)]: true
              })}
              label='+'
              l10nId='newTabButton'
              testId='newTabButton'
              disabled={false}
              onClick={this.newTab}
              onLongPress={this.onNewTabLongPress}
            />
          </div>
        </ListWithTransitions>
      ]}
    </div>
  }
}

const styles = StyleSheet.create({
  tabs: {
    boxSizing: 'border-box',
    display: 'flex',
    flex: 1,
    overflow: 'auto',
    padding: 0,
    height: '-webkit-fill-available',
    position: 'relative',
    whiteSpace: 'nowrap',
    zIndex: globalStyles.zindex.zindexTabs
  },

  tabs__tabStrip: {
    display: 'flex',
    flex: 1,
    zIndex: globalStyles.zindex.zindexTabs,
    overflow: 'hidden',
    position: 'relative'
  },

  tabs__tabStrip_isPreview: globalStyles.animations.tabFadeIn,

  tabs__tabStrip_allowDragging: {
    WebkitAppRegion: 'drag'
  },

  tabs__tabStrip__navigation: {
    fontSize: '21px',
    height: globalStyles.spacing.tabsToolbarHeight,
    lineHeight: globalStyles.spacing.tabsToolbarHeight,
    backgroundColor: '#ddddddaa',
    zIndex: 400,
    borderRadius: 0
  },

  tabs__tabStrip__navigation_isPausing: {
    backgroundColor: theme.tabsToolbar.button.changingPage.toBackgroundColor,
    color: theme.tabsToolbar.button.changingPage.color,
    animationName: [{
      'from': {
        backgroundColor: theme.tabsToolbar.button.changingPage.fromBackgroundColor
      },
      'to': {
        backgroundColor: theme.tabsToolbar.button.changingPage.toBackgroundColor
      }
    }],
    animationDuration: '1s',
    ':hover': {
      color: theme.tabsToolbar.button.changingPage.color // :-( aphrodite
    }
  },

  tabs__tabStrip__navigation_prev: {
    paddingRight: '2px',

    // Override border:none specified with browserButton
    borderWidth: '0 1px 0 0',
    borderStyle: 'solid',
    borderColor: theme.tabsToolbar.tabs.navigation.borderColor
  },

  tabs__tabStrip__navigation_next: {
    paddingLeft: '2px'
  },
  tabs__postTabButtons: {
    background: '#ddd',
    zIndex: 400,
    opacity: 1,
    transition: 'opacity 120ms ease-in-out'
  },
  tabs__postTabButtons_isInvisible: {
    opacity: 0
  },
  tabs__tabStrip__newTabButton: {
    background: theme.tabsToolbar.button.backgroundColor,
    minWidth: globalStyles.spacing.tabsToolbarHeight,
    minHeight: globalStyles.spacing.tabsToolbarHeight,
    lineHeight: globalStyles.spacing.tabsToolbarHeight,
    WebkitMaskImage: `url(${newTabButton})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: '12px 12px',
    WebkitMaskOrigin: 'border',
    // no-drag is applied to the button and tab area
    WebkitAppRegion: 'no-drag',

    ':hover': {
      opacity: 1.0,
      backgroundColor: theme.tabsToolbar.button.onHover.backgroundColor
    }
  }
})

module.exports = ReduxComponent.connect(Tabs)
