/**
 * A small stand-in for require("premierepro"), shaped like the UXP DOM: async
 * getters, Actions that may only be created inside project.lockedAccess (as
 * Premiere Pro enforces from 26.3), and executeTransaction that applies them
 * as one undo step. Enough for the end-to-end tests of a few tools; not a model
 * of Premiere Pro.
 */
export function fakePremiere() {
    let locked = false;
    const undo = [];
    const tick = (seconds) => ({ seconds, ticks: String(Math.round(seconds * 254016000000)) });
    const action = (apply) => {
        if (!locked) throw new Error('Actions must be created inside project.lockedAccess');
        return { apply };
    };

    const markerList = [];
    let nextGuid = 1;
    function makeMarker(name, type, start, duration, comments) {
        const m = {
            name, type, start, duration, comments, color: 0, guid: { toString: () => `marker-${nextGuid}` },
            getName: () => m.name, getType: () => m.type, getStart: () => m.start, getDuration: () => m.duration,
            getComments: () => m.comments, getColorIndex: () => m.color, getUrl: () => '', getTarget: () => '',
            createSetColorByIndexAction: (i) => action(() => { m.color = i; }),
            createSetNameAction: (n) => action(() => { m.name = n; }),
        };
        nextGuid++;
        return m;
    }
    const markers = {
        getMarkers: () => markerList.slice(),
        createAddMarkerAction: (name, type, start, duration, comments) => action(() => markerList.push(makeMarker(name, type, start, duration, comments))),
        createRemoveMarkerAction: (m) => action(() => markerList.splice(markerList.indexOf(m), 1)),
        createMoveMarkerAction: (m, t) => action(() => { m.start = t; }),
    };

    const sequence = {
        name: 'Main edit',
        guid: { toString: () => 'seq-1' },
        inPoint: tick(0), outPoint: tick(60), zeroPoint: tick(0), playhead: tick(0),
        getFrameSize: async () => ({ width: 1920, height: 1080 }),
        getTimebase: async () => '10584000000',
        getEndTime: async () => tick(60),
        getInPoint: async () => sequence.inPoint,
        getOutPoint: async () => sequence.outPoint,
        getZeroPoint: async () => sequence.zeroPoint,
        getPlayerPosition: async () => sequence.playhead,
        setPlayerPosition: async (t) => { sequence.playhead = t; return true; },
        getVideoTrackCount: async () => 3,
        getAudioTrackCount: async () => 4,
        getCaptionTrackCount: async () => 0,
        createSetInPointAction: (t) => action(() => { sequence.inPoint = t; }),
        createSetOutPointAction: (t) => action(() => { sequence.outPoint = t; }),
        createSetZeroPointAction: (t) => action(() => { sequence.zeroPoint = t; }),
    };

    const project = {
        name: 'Documentary', path: '/Users/editor/Documentary.prproj', guid: { toString: () => 'project-1' },
        getActiveSequence: async () => sequence,
        getSequences: async () => [sequence],
        lockedAccess(callback) {
            locked = true;
            try { callback(); } finally { locked = false; }
        },
        executeTransaction(callback, name) {
            if (!locked) throw new Error('executeTransaction outside lockedAccess');
            const compound = { actions: [], addAction(a) { this.actions.push(a); return true; } };
            callback(compound);
            for (const a of compound.actions) a.apply();
            undo.push(name);
            return true;
        },
    };

    const ppro = {
        Project: { getActiveProject: async () => project },
        Markers: { getMarkers: async (owner) => (owner === sequence ? markers : null) },
        TickTime: { createWithSeconds: tick },
        Constants: {
            MarkerColor: { GREEN: 0, RED: 1, MAGENTA: 2, ORANGE: 3, YELLOW: 4, BLUE: 6, CYAN: 7 },
            TrackItemType: { EMPTY: 0, CLIP: 1 },
            MediaType: { ANY: 0 },
        },
    };
    return { ppro, project, sequence, markerList, undo };
}
