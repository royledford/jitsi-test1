/* global $, APP, interfaceConfig */

/* eslint-disable no-unused-vars */
import React from 'react';
import ReactDOM from 'react-dom';

import { browser } from '../../../react/features/base/lib-jitsi-meet';
import {
    ORIENTATION,
    LargeVideoBackground,
    LargeVideoBackgroundCanvas
} from '../../../react/features/large-video';
/* eslint-enable no-unused-vars */

import Filmstrip from './Filmstrip';
import LargeContainer from './LargeContainer';
import UIEvents from '../../../service/UI/UIEvents';
import UIUtil from '../util/UIUtil';

// FIXME should be 'video'
export const VIDEO_CONTAINER_TYPE = 'camera';

const FADE_DURATION_MS = 300;

/**
 * The CSS class used to add a filter effect on the large video when there is
 * a problem with local video.
 *
 * @private
 * @type {string}
 */
const LOCAL_PROBLEM_FILTER_CLASS = 'videoProblemFilter';

/**
 * The CSS class used to add a filter effect on the large video when there is
 * a problem with remote video.
 *
 * @private
 * @type {string}
 */
const REMOTE_PROBLEM_FILTER_CLASS = 'remoteVideoProblemFilter';

/**
 * Returns an array of the video dimensions, so that it keeps it's aspect
 * ratio and fits available area with it's larger dimension. This method
 * ensures that whole video will be visible and can leave empty areas.
 *
 * @param videoWidth the width of the video to position
 * @param videoHeight the height of the video to position
 * @param videoSpaceWidth the width of the available space
 * @param videoSpaceHeight the height of the available space
 * @return an array with 2 elements, the video width and the video height
 */
function computeDesktopVideoSize( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight) {
    const aspectRatio = videoWidth / videoHeight;

    let availableWidth = Math.max(videoWidth, videoSpaceWidth);
    let availableHeight = Math.max(videoHeight, videoSpaceHeight);

    if (interfaceConfig.VERTICAL_FILMSTRIP) {
        // eslint-disable-next-line no-param-reassign
        videoSpaceWidth -= Filmstrip.getFilmstripWidth();
    } else {
        // eslint-disable-next-line no-param-reassign
        videoSpaceHeight -= Filmstrip.getFilmstripHeight();
    }

    if (availableWidth / aspectRatio >= videoSpaceHeight) {
        availableHeight = videoSpaceHeight;
        availableWidth = availableHeight * aspectRatio;
    }

    if (availableHeight * aspectRatio >= videoSpaceWidth) {
        availableWidth = videoSpaceWidth;
        availableHeight = availableWidth / aspectRatio;
    }

    return [ availableWidth, availableHeight ];
}


/**
 * Returns an array of the video dimensions. It respects the
 * VIDEO_LAYOUT_FIT config, to fit the video to the screen, by hiding some parts
 * of it, or to fit it to the height or width.
 *
 * @param videoWidth the original video width
 * @param videoHeight the original video height
 * @param videoSpaceWidth the width of the video space
 * @param videoSpaceHeight the height of the video space
 * @return an array with 2 elements, the video width and the video height
 */
function computeCameraVideoSize( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight,
        videoLayoutFit) {
    const aspectRatio = videoWidth / videoHeight;

    switch (videoLayoutFit) {
    case 'height':
        return [ videoSpaceHeight * aspectRatio, videoSpaceHeight ];
    case 'width':
        return [ videoSpaceWidth, videoSpaceWidth / aspectRatio ];
    case 'both': {
        const videoSpaceRatio = videoSpaceWidth / videoSpaceHeight;
        const maxZoomCoefficient = interfaceConfig.MAXIMUM_ZOOMING_COEFFICIENT
            || Infinity;

        if (videoSpaceRatio === aspectRatio) {
            return [ videoSpaceWidth, videoSpaceHeight ];
        }

        let [ width, height ] = computeCameraVideoSize(
            videoWidth,
            videoHeight,
            videoSpaceWidth,
            videoSpaceHeight,
            videoSpaceRatio < aspectRatio ? 'height' : 'width');
        const maxWidth = videoSpaceWidth * maxZoomCoefficient;
        const maxHeight = videoSpaceHeight * maxZoomCoefficient;

        if (width > maxWidth) {
            width = maxWidth;
            height = width / aspectRatio;
        } else if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }

        return [ width, height ];
    }
    default:
        return [ videoWidth, videoHeight ];
    }
}

/**
 * Returns an array of the video horizontal and vertical indents,
 * so that if fits its parent.
 *
 * @return an array with 2 elements, the horizontal indent and the vertical
 * indent
 */
function getCameraVideoPosition( // eslint-disable-line max-params
        videoWidth,
        videoHeight,
        videoSpaceWidth,
        videoSpaceHeight) {
    // Parent height isn't completely calculated when we position the video in
    // full screen mode and this is why we use the screen height in this case.
    // Need to think it further at some point and implement it properly.
    if (UIUtil.isFullScreen()) {
        // eslint-disable-next-line no-param-reassign
        videoSpaceHeight = window.innerHeight;
    }

    const horizontalIndent = (videoSpaceWidth - videoWidth) / 2;
    const verticalIndent = (videoSpaceHeight - videoHeight) / 2;

    return { horizontalIndent,
        verticalIndent };
}

/**
 * Returns an array of the video horizontal and vertical indents.
 * Centers horizontally and top aligns vertically.
 *
 * @return an array with 2 elements, the horizontal indent and the vertical
 * indent
 */
function getDesktopVideoPosition(videoWidth, videoHeight, videoSpaceWidth) {
    const horizontalIndent = (videoSpaceWidth - videoWidth) / 2;

    const verticalIndent = 0;// Top aligned

    return { horizontalIndent,
        verticalIndent };
}

/**
 * Container for user video.
 */
export class VideoContainer extends LargeContainer {
    // FIXME: With Temasys we have to re-select everytime
    /**
     *
     */
    get $video() {
        return $('#largeVideo');
    }

    /**
     *
     */
    get id() {
        return this.userId;
    }

    /**
     * Creates new VideoContainer instance.
     * @param resizeContainer {Function} function that takes care of the size
     * of the video container.
     * @param emitter {EventEmitter} the event emitter that will be used by
     * this instance.
     */
    constructor(resizeContainer, emitter) {
        super();
        this.stream = null;
        this.userId = null;
        this.videoType = null;
        this.localFlipX = true;
        this.emitter = emitter;
        this.resizeContainer = resizeContainer;

        this.isVisible = false;

        /**
         * Whether the background should fit the height of the container
         * (portrait) or fit the width of the container (landscape).
         *
         * @private
         * @type {string|null}
         */
        this._backgroundOrientation = null;

        /**
         * Flag indicates whether or not the background should be rendered.
         * If the background will not be visible then it is hidden to save
         * on performance.
         * @type {boolean}
         */
        this._hideBackground = true;

        /**
         * Flag indicates whether or not the avatar is currently displayed.
         * @type {boolean}
         */
        this.avatarDisplayed = false;
        this.$avatar = $('#dominantSpeaker');

        /**
         * A jQuery selector of the remote connection message.
         * @type {jQuery|HTMLElement}
         */
        this.$remoteConnectionMessage = $('#remoteConnectionMessage');

        this.$remotePresenceMessage = $('#remotePresenceMessage');

        /**
         * Indicates whether or not the video stream attached to the video
         * element has started(which means that there is any image rendered
         * even if the video is stalled).
         * @type {boolean}
         */
        this.wasVideoRendered = false;

        this.$wrapper = $('#largeVideoWrapper');

        /**
         * FIXME: currently using parent() because I can't come up with name
         * for id. We'll need to probably refactor the HTML related to the large
         * video anyway.
         */
        this.$wrapperParent = this.$wrapper.parent();

        this.avatarHeight = $('#dominantSpeakerAvatar').height();

        const onPlayingCallback = function(event) {
            if (typeof resizeContainer === 'function') {
                resizeContainer(event);
            }
            this.wasVideoRendered = true;
        }.bind(this);

        // This does not work with Temasys plugin - has to be a property to be
        // copied between new <object> elements
        // this.$video.on('play', onPlay);

        this.$video[0].onplaying = onPlayingCallback;

        /**
         * A Set of functions to invoke when the video element resizes.
         *
         * @private
         */
        this._resizeListeners = new Set();

        // As of May 16, 2017, temasys does not support resize events.
        this.$video[0].onresize = this._onResize.bind(this);
    }

    /**
     * Adds a function to the known subscribers of video element resize
     * events.
     *
     * @param {Function} callback - The subscriber to notify when the video
     * element resizes.
     * @returns {void}
     */
    addResizeListener(callback) {
        this._resizeListeners.add(callback);
    }

    /**
     * Enables a filter on the video which indicates that there are some
     * problems with the local media connection.
     *
     * @param {boolean} enable <tt>true</tt> if the filter is to be enabled or
     * <tt>false</tt> otherwise.
     */
    enableLocalConnectionProblemFilter(enable) {
        this.$video.toggleClass(LOCAL_PROBLEM_FILTER_CLASS, enable);
        this._updateBackground();
    }

    /**
     * Obtains media stream ID of the underlying {@link JitsiTrack}.
     * @return {string|null}
     */
    getStreamID() {
        return this.stream ? this.stream.getId() : null;
    }

    /**
     * Get size of video element.
     * @returns {{width, height}}
     */
    getStreamSize() {
        const video = this.$video[0];


        return {
            width: video.videoWidth,
            height: video.videoHeight
        };
    }

    /**
     * Calculate optimal video size for specified container size.
     * @param {number} containerWidth container width
     * @param {number} containerHeight container height
     * @returns {{availableWidth, availableHeight}}
     */
    getVideoSize(containerWidth, containerHeight) {
        const { width, height } = this.getStreamSize();

        if (this.stream && this.isScreenSharing()) {
            return computeDesktopVideoSize(width,
                height,
                containerWidth,
                containerHeight);
        }

        return computeCameraVideoSize(width,
            height,
            containerWidth,
            containerHeight,
            interfaceConfig.VIDEO_LAYOUT_FIT);
    }

    /* eslint-disable max-params */
    /**
     * Calculate optimal video position (offset for top left corner)
     * for specified video size and container size.
     * @param {number} width video width
     * @param {number} height video height
     * @param {number} containerWidth container width
     * @param {number} containerHeight container height
     * @returns {{horizontalIndent, verticalIndent}}
     */
    getVideoPosition(width, height, containerWidth, containerHeight) {
        /* eslint-enable max-params */
        if (this.stream && this.isScreenSharing()) {
            let availableContainerWidth = containerWidth;

            if (interfaceConfig.VERTICAL_FILMSTRIP) {
                availableContainerWidth -= Filmstrip.getFilmstripWidth();
            }

            return getDesktopVideoPosition(width,
                height,
                availableContainerWidth,
                containerHeight);
        }

        return getCameraVideoPosition(width,
                height,
                containerWidth,
                containerHeight);

    }

    /**
     * Updates the positioning of the remote connection presence message and the
     * connection status message which escribes that the remote user is having
     * connectivity issues.
     *
     * @returns {void}
     */
    positionRemoteStatusMessages() {
        this._positionParticipantStatus(this.$remoteConnectionMessage);
        this._positionParticipantStatus(this.$remotePresenceMessage);
    }

    /**
     * Modifies the position of the passed in jQuery object so it displays
     * in the middle of the video container or below the avatar.
     *
     * @private
     * @returns {void}
     */
    _positionParticipantStatus($element) {
        if (this.avatarDisplayed) {
            const $avatarImage = $('#dominantSpeakerAvatar');

            $element.css(
                'top',
                $avatarImage.offset().top + $avatarImage.height() + 10);
        } else {
            const height = $element.height();
            const parentHeight = $element.parent().height();

            $element.css('top', (parentHeight / 2) - (height / 2));
        }
    }

    /**
     *
     */
    resize(containerWidth, containerHeight, animate = false) {
        // XXX Prevent TypeError: undefined is not an object when the Web
        // browser does not support WebRTC (yet).
        if (this.$video.length === 0) {
            return;
        }

        const [ width, height ]
            = this.getVideoSize(containerWidth, containerHeight);

        if ((containerWidth > width) || (containerHeight > height)) {
            this._backgroundOrientation = containerWidth > width
                ? ORIENTATION.LANDSCAPE : ORIENTATION.PORTRAIT;
            this._hideBackground = false;
        } else {
            this._hideBackground = true;
        }

        this._updateBackground();

        const { horizontalIndent, verticalIndent }
            = this.getVideoPosition(width, height,
            containerWidth, containerHeight);

        // update avatar position
        const top = (containerHeight / 2) - (this.avatarHeight / 4 * 3);

        this.$avatar.css('top', top);

        this.positionRemoteStatusMessages();

        this.$wrapper.animate({
            width,
            height,

            top: verticalIndent,
            bottom: verticalIndent,

            left: horizontalIndent,
            right: horizontalIndent
        }, {
            queue: false,
            duration: animate ? 500 : 0
        });
    }

    /**
     * Removes a function from the known subscribers of video element resize
     * events.
     *
     * @param {Function} callback - The callback to remove from known
     * subscribers of video resize events.
     * @returns {void}
     */
    removeResizeListener(callback) {
        this._resizeListeners.delete(callback);
    }

    /**
     * Update video stream.
     * @param {string} userID
     * @param {JitsiTrack?} stream new stream
     * @param {string} videoType video type
     */
    setStream(userID, stream, videoType) {
        this.userId = userID;
        if (this.stream === stream) {
            // Handles the use case for the remote participants when the
            // videoType is received with delay after turning on/off the
            // desktop sharing.
            if (this.videoType !== videoType) {
                this.videoType = videoType;
                this.resizeContainer();
            }

            return;
        }

        // The stream has changed, so the image will be lost on detach
        this.wasVideoRendered = false;


        // detach old stream
        if (this.stream) {
            this.stream.detach(this.$video[0]);
        }

        this.stream = stream;
        this.videoType = videoType;

        if (!stream) {
            return;
        }

        stream.attach(this.$video[0]);

        const flipX = stream.isLocal() && this.localFlipX;

        this.$video.css({
            transform: flipX ? 'scaleX(-1)' : 'none'
        });

        this._updateBackground();

        // Reset the large video background depending on the stream.
        this.setLargeVideoBackground(this.avatarDisplayed);
    }

    /**
     * Changes the flipX state of the local video.
     * @param val {boolean} true if flipped.
     */
    setLocalFlipX(val) {
        this.localFlipX = val;
        if (!this.$video || !this.stream || !this.stream.isLocal()) {
            return;
        }
        this.$video.css({
            transform: this.localFlipX ? 'scaleX(-1)' : 'none'
        });

        this._updateBackground();
    }


    /**
     * Check if current video stream is screen sharing.
     * @returns {boolean}
     */
    isScreenSharing() {
        return this.videoType === 'desktop';
    }

    /**
     * Show or hide user avatar.
     * @param {boolean} show
     */
    showAvatar(show) {
        // TO FIX: Video background need to be black, so that we don't have a
        // flickering effect when scrolling between videos and have the screen
        // move to grey before going back to video. Avatars though can have the
        // default background set.
        // In order to fix this code we need to introduce video background or
        // find a workaround for the video flickering.
        this.setLargeVideoBackground(show);

        this.$avatar.css('visibility', show ? 'visible' : 'hidden');
        this.avatarDisplayed = show;

        this.emitter.emit(UIEvents.LARGE_VIDEO_AVATAR_VISIBLE, show);
        APP.API.notifyLargeVideoVisibilityChanged(show);
    }

    /**
     * Indicates that the remote user who is currently displayed by this video
     * container is having connectivity issues.
     *
     * @param {boolean} show <tt>true</tt> to show or <tt>false</tt> to hide
     * the indication.
     */
    showRemoteConnectionProblemIndicator(show) {
        this.$video.toggleClass(REMOTE_PROBLEM_FILTER_CLASS, show);
        this.$avatar.toggleClass(REMOTE_PROBLEM_FILTER_CLASS, show);
        this._updateBackground();
    }


    /**
     * We are doing fadeOut/fadeIn animations on parent div which wraps
     * largeVideo, because when Temasys plugin is in use it replaces
     * <video> elements with plugin <object> tag. In Safari jQuery is
     * unable to store values on this plugin object which breaks all
     * animation effects performed on it directly.
     */
    show() {
        // its already visible
        if (this.isVisible) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.$wrapperParent.css('visibility', 'visible').fadeTo(
                FADE_DURATION_MS,
                1,
                () => {
                    this.isVisible = true;
                    resolve();
                }
            );
        });
    }

    /**
     *
     */
    hide() {
        // as the container is hidden/replaced by another container
        // hide its avatar
        this.showAvatar(false);

        // its already hidden
        if (!this.isVisible) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.$wrapperParent.fadeTo(FADE_DURATION_MS, 0, () => {
                this.$wrapperParent.css('visibility', 'hidden');
                this.isVisible = false;
                resolve();
            });
        });
    }

    /**
     * @return {boolean} switch on dominant speaker event if on stage.
     */
    stayOnStage() {
        return false;
    }

    /**
     * Sets the large video container background depending on the container
     * type and the parameter indicating if an avatar is currently shown on
     * large.
     *
     * @param {boolean} isAvatar - Indicates if the avatar is currently shown
     * on the large video.
     * @returns {void}
     */
    setLargeVideoBackground(isAvatar) {
        $('#largeVideoContainer').css('background',
            this.videoType === VIDEO_CONTAINER_TYPE && !isAvatar
                ? '#000' : interfaceConfig.DEFAULT_BACKGROUND);
    }

    /**
     * Callback invoked when the video element changes dimensions.
     *
     * @private
     * @returns {void}
     */
    _onResize() {
        this._resizeListeners.forEach(callback => callback());
    }

    /**
     * Attaches and/or updates a React Component to be used as a background for
     * the large video, to display blurred video and fill up empty space not
     * taken up by the large video.
     *
     * @private
     * @returns {void}
     */
    _updateBackground() {
        // Do not the background display on browsers that might experience
        // performance issues from the presence of the background.
        if (interfaceConfig._BACKGROUND_BLUR === 'off'
                || browser.isFirefox()
                || browser.isSafariWithWebrtc()
                || browser.isTemasysPluginUsed()) {
            return;
        }

        // eslint-disable-next-line no-unused-vars
        const Background = interfaceConfig._BACKGROUND_BLUR === 'canvas'
            ? LargeVideoBackgroundCanvas
            : LargeVideoBackground;

        ReactDOM.render(
            <Background
                hidden = { this._hideBackground }
                mirror = {
                    this.stream
                    && this.stream.isLocal()
                    && this.localFlipX
                }
                orientationFit = { this._backgroundOrientation }
                showLocalProblemFilter
                    = { this.$video.hasClass(LOCAL_PROBLEM_FILTER_CLASS) }
                showRemoteProblemFilter
                    = { this.$video.hasClass(REMOTE_PROBLEM_FILTER_CLASS) }
                videoElement = { this.$video && this.$video[0] }
                videoTrack = { this.stream } />,
            document.getElementById('largeVideoBackgroundContainer')
        );
    }
}