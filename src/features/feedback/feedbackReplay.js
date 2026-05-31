/**
 * Feedback replay recorder.
 * Uses rrweb's maintained record package to keep a compact interaction trace.
 */

const MAX_REPLAY_EVENTS = 300;
const MAX_REPLAY_BYTES = 2.5 * 1024 * 1024;

const replayEvents = [];
const listeners = new Set();

let recordApi = null;
let stopRecording = null;
let startPromise = null;
let recordingStartedAt = null;
let recordingError = null;
let recordingEndedAt = null;

function getEventTime(event) {
    return event?.timestamp ? new Date(event.timestamp).toISOString() : null;
}

function measureBytes(value) {
    return new TextEncoder().encode(value).length;
}

function encodeBase64(value) {
    const bytes = new TextEncoder().encode(value);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}

function buildReplayPayload(events) {
    return {
        kind: 'rrweb-replay',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        url: window.location.href,
        title: document.title,
        eventCount: events.length,
        startedAt: recordingStartedAt,
        endedAt: recordingEndedAt,
        firstEventAt: getEventTime(events[0]),
        lastEventAt: getEventTime(events[events.length - 1]),
        events,
    };
}

export function getFeedbackReplayPreview() {
    return buildReplayPayload(replayEvents.slice());
}

function emitReplayState() {
    const state = getFeedbackReplayContext();
    listeners.forEach((listener) => {
        listener(state);
    });
}

function fitEventsToBudget() {
    let events = replayEvents.slice(-MAX_REPLAY_EVENTS);

    while (events.length > 0) {
        const json = JSON.stringify(buildReplayPayload(events));
        if (measureBytes(json) <= MAX_REPLAY_BYTES) {
            return { events, json };
        }

        const trimCount = Math.max(1, Math.ceil(events.length * 0.15));
        events = events.slice(trimCount);
    }

    return null;
}

export function recordFeedbackReplayEvent(event) {
    replayEvents.push(event);

    if (replayEvents.length > MAX_REPLAY_EVENTS) {
        replayEvents.splice(0, replayEvents.length - MAX_REPLAY_EVENTS);
    }
}

export function getFeedbackReplayContext() {
    return {
        enabled: !!stopRecording,
        startedAt: recordingStartedAt,
        endedAt: recordingEndedAt,
        eventCount: replayEvents.length,
        firstEventAt: getEventTime(replayEvents[0]),
        lastEventAt: getEventTime(replayEvents[replayEvents.length - 1]),
        error: recordingError,
    };
}

export function onFeedbackReplayStateChange(listener) {
    listeners.add(listener);
    listener(getFeedbackReplayContext());
    return () => listeners.delete(listener);
}

export async function createFeedbackReplayAttachment() {
    if (replayEvents.length === 0) {
        return null;
    }

    if (stopRecording) {
        try {
            recordApi?.takeFullSnapshot?.(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
        } catch {
            // The cached incremental events are still useful if a final snapshot fails.
        }
    }

    const fitted = fitEventsToBudget();
    if (!fitted) {
        return null;
    }

    const payload = buildReplayPayload(fitted.events);
    const json = JSON.stringify(payload);

    return {
        name: `feedback-rrweb-${Date.now()}.json`,
        type: 'application/json',
        size: measureBytes(json),
        dataUrl: `data:application/json;base64,${encodeBase64(json)}`,
    };
}

export async function startFeedbackReplayRecording() {
    if (stopRecording) {
        return true;
    }

    if (startPromise) {
        return startPromise;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }

    replayEvents.length = 0;
    recordingStartedAt = null;
    recordingEndedAt = null;
    recordingError = null;

    startPromise = startReplayRecording();
    const started = await startPromise;
    startPromise = null;
    return started;
}

export function stopFeedbackReplayRecording() {
    if (!stopRecording) {
        return false;
    }

    try {
        recordApi?.takeFullSnapshot?.(true);
    } catch {
        // rrweb can reject snapshots during teardown; keep the existing event buffer.
    }

    stopRecording();
    stopRecording = null;
    recordingEndedAt = new Date().toISOString();
    emitReplayState();
    return true;
}

async function startReplayRecording() {
    try {
        const rrwebRecord = await import('@rrweb/record');
        const record = rrwebRecord.record || rrwebRecord.default;

        recordApi = record;
        recordingStartedAt = new Date().toISOString();
        recordingEndedAt = null;
        recordingError = null;
        stopRecording = record({
            emit: recordFeedbackReplayEvent,
            checkoutEveryNms: 60 * 1000,
            maskAllInputs: true,
            inlineImages: false,
            collectFonts: false,
            recordCanvas: false,
            slimDOMOptions: 'all',
            sampling: {
                mousemove: false,
                scroll: 150,
                media: 800,
                input: 'last',
            },
        });

        emitReplayState();
        return !!stopRecording;
    } catch (error) {
        recordingError = error?.message || String(error);
        stopRecording = null;
        emitReplayState();
        return false;
    }
}
