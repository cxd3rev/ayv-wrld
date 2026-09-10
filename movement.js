const mosaic = document.getElementById("mosaic");
const panes = Array.from(document.querySelectorAll(".pane"));
const shards = Array.from(document.querySelectorAll(".mosaic .pane"));
const infoView = document.getElementById("infoView");
const cornerLobe = document.getElementById("cornerLobe");
const infoArticles = Array.from(document.querySelectorAll(".info-copy article[data-info]"));
const logoButtons = Array.from(document.querySelectorAll(".info-logo-btn"));
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const mosaicMorphQuery = window.matchMedia("(min-width: 901px)");

function replicateMosaicFaces() {
    const source = document.querySelector(".mosaic-face");
    if (!source) {
        return;
    }
    shards.forEach(function (pane) {
        if (pane.querySelector(".mosaic-face")) {
            return;
        }
        const clone = source.cloneNode(true);
        clone.querySelectorAll("[id]").forEach(function (el) {
            el.removeAttribute("id");
        });
        pane.appendChild(clone);
    });
}

replicateMosaicFaces();

const MASTER = {
    hero: [
        [0, 0], [42, 0], [37, 38], [40, 68], [35, 100], [0, 100]
    ],
    story: [
        [42, 0], [100, 0], [100, 34], [70, 32], [37, 38]
    ],
    journey: [
        [100, 34], [100, 70], [72, 66], [70, 32]
    ],
    skills: [
        [37, 38], [70, 32], [72, 66], [40, 68]
    ],
    work: [
        [40, 68], [72, 66], [100, 70], [100, 100], [35, 100]
    ]
};

const GAP = 0.016;
const PUSH = 2.15;
const GLOW_MS = 950;
const LERP_CLIP = 0.12;
const LERP_TILT = 0.13;
const LERP_HIGHLIGHT = 0.12;
const LERP_NAV = 0.12;
const SETTLE = 0.045;
const CLIP_SETTLE = 0.02;

function vertKey(p) {
    return `${p[0]},${p[1]}`;
}

const owners = {};
Object.keys(MASTER).forEach(function (name) {
    MASTER[name].forEach(function (p) {
        const k = vertKey(p);
        if (!owners[k]) {
            owners[k] = [];
        }
        owners[k].push(name);
    });
});

const shardState = shards.map(function (pane) {
    const key = pane.dataset.shape;
    const rest = (MASTER[key] || []).map(function (p) {
        return { x: p[0], y: p[1] };
    });
    return {
        pane: pane,
        key: key,
        rest: rest,
        current: rest.map(function (p) {
            return { x: p.x, y: p.y };
        }),
        lastPath: ""
    };
});

const paneMeta = panes.map(function (pane) {
    const box = pane.dataset.box;
    const stage = pane.closest(".creation-stage");
    const isNav = pane.classList.contains("pane-nav");
    const parts = box ? box.split(" ").map(Number) : null;
    return {
        pane: pane,
        isNav: isNav,
        stage: stage,
        box: parts,
        inInfo: !!(infoView && infoView.contains(pane)),
        inMosaic: !!(mosaic && mosaic.contains(pane)),
        shell: isNav ? pane.parentElement : null,
        padL: 0,
        padR: 0,
        padT: 0,
        rect: { left: 0, top: 0, width: 0, height: 0 },
        visible: false,
        css: {}
    };
});

const navMeta = paneMeta.find(function (item) {
    return item.isNav;
}) || null;

const state = {
    mouseX: window.innerWidth / 2,
    mouseY: window.innerHeight / 2,
    hovered: -1,
    hotPane: -1,
    navShiftX: 0,
    navShiftY: 0,
    navTargetShiftX: 0,
    navTargetShiftY: 0,
    items: panes.map(function () {
        return {
            rx: 0,
            ry: 0,
            hx: 42,
            hy: 12,
            targetRx: 0,
            targetRy: 0,
            targetHx: 42,
            targetHy: 12
        };
    })
};

const geom = {
    dirty: true,
    mosaic: { left: 0, top: 0, width: 0, height: 0 },
    nav: { left: 0, top: 0, width: 0, height: 0 }
};

let reduceMotion = reduceMotionQuery.matches;
let allowMorph = mosaicMorphQuery.matches;
let rafRunning = false;
let rafQueued = false;
let clipsSettled = false;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function nearly(a, b, eps) {
    return Math.abs(a - b) < (eps || SETTLE);
}

function influence(distance, radius) {
    const t = clamp(1 - distance / radius, 0, 1);
    return t * t * (3 - 2 * t);
}

function centroid(points) {
    let x = 0;
    let y = 0;
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
        x += points[i].x;
        y += points[i].y;
    }
    return { x: x / n, y: y / n };
}

function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x;
        const yi = points[i].y;
        const xj = points[j].x;
        const yj = points[j].y;
        const hit = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.0001) + xi);
        if (hit) {
            inside = !inside;
        }
    }
    return inside;
}

function roundedPath(points, radius) {
    const n = points.length;
    if (n < 3) {
        return "";
    }

    let d = "";
    for (let i = 0; i < n; i += 1) {
        const prev = points[(i + n - 1) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];
        const v1x = curr.x - prev.x;
        const v1y = curr.y - prev.y;
        const v2x = next.x - curr.x;
        const v2y = next.y - curr.y;
        const len1 = Math.hypot(v1x, v1y) || 1;
        const len2 = Math.hypot(v2x, v2y) || 1;
        const r = Math.min(radius, len1 * 0.42, len2 * 0.42);
        const p1x = curr.x - (v1x / len1) * r;
        const p1y = curr.y - (v1y / len1) * r;
        const p2x = curr.x + (v2x / len2) * r;
        const p2y = curr.y + (v2y / len2) * r;

        d += i === 0 ? `M ${p1x} ${p1y}` : `L ${p1x} ${p1y}`;
        d += ` Q ${curr.x} ${curr.y} ${p2x} ${p2y}`;
    }
    return d + " Z";
}

function isInfoView() {
    return document.body.classList.contains("is-info");
}

function paneIsActive(meta) {
    if (meta.inInfo && infoView && infoView.hasAttribute("hidden")) {
        return false;
    }
    if (meta.inMosaic && isInfoView()) {
        return false;
    }
    return true;
}

function readNavPadding(meta) {
    if (!meta || !meta.shell) {
        return;
    }
    const cs = getComputedStyle(meta.shell);
    meta.padL = parseFloat(cs.paddingLeft) || 0;
    meta.padR = parseFloat(cs.paddingRight) || 0;
    meta.padT = parseFloat(cs.paddingTop) || 0;
}

function measurePane(meta) {
    const pane = meta.pane;
    if (meta.isNav && meta.shell) {
        const box = meta.shell.getBoundingClientRect();
        meta.rect.left = box.left + meta.padL;
        meta.rect.top = box.top + meta.padT;
        meta.rect.width = Math.max(0, box.width - meta.padL - meta.padR);
        meta.rect.height = pane.offsetHeight;
        geom.nav.left = meta.rect.left;
        geom.nav.top = meta.rect.top;
        geom.nav.width = meta.rect.width;
        geom.nav.height = meta.rect.height;
        return;
    }

    if (meta.stage) {
        const box = meta.stage.getBoundingClientRect();
        meta.rect.left = box.left;
        meta.rect.top = box.top;
        meta.rect.width = box.width;
        meta.rect.height = box.height;
        return;
    }

    if (meta.box && mosaic) {
        const mosaicRect = geom.mosaic;
        meta.rect.left = mosaicRect.left + mosaicRect.width * meta.box[0] / 100;
        meta.rect.top = mosaicRect.top + mosaicRect.height * meta.box[1] / 100;
        meta.rect.width = mosaicRect.width * meta.box[2] / 100;
        meta.rect.height = mosaicRect.height * meta.box[3] / 100;
        return;
    }

    const box = pane.getBoundingClientRect();
    meta.rect.left = box.left;
    meta.rect.top = box.top;
    meta.rect.width = box.width;
    meta.rect.height = box.height;
}

function refreshGeometry() {
    if (!geom.dirty) {
        return;
    }
    geom.dirty = false;

    if (mosaic) {
        const rect = mosaic.getBoundingClientRect();
        geom.mosaic.left = rect.left;
        geom.mosaic.top = rect.top;
        geom.mosaic.width = rect.width;
        geom.mosaic.height = rect.height;
    }

    if (navMeta) {
        readNavPadding(navMeta);
    }

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    paneMeta.forEach(function (meta) {
        if (!paneIsActive(meta)) {
            meta.visible = false;
            return;
        }
        measurePane(meta);
        const r = meta.rect;
        meta.visible = r.width > 0 && r.height > 0 &&
            r.left < viewW && r.top < viewH &&
            r.left + r.width > 0 && r.top + r.height > 0;
    });
}

function invalidateGeometry() {
    geom.dirty = true;
    clipsSettled = false;
    requestWork();
}

function tiltOverflow(width, height, tiltXDeg, tiltYDeg) {
    const perspective = 1200;
    const radY = tiltYDeg * Math.PI / 180;
    const radX = tiltXDeg * Math.PI / 180;
    const halfW = width / 2;
    const halfH = height / 2;
    const zY = Math.abs(Math.sin(radY)) * halfW;
    const xProj = Math.abs(Math.cos(radY)) * halfW * perspective / Math.max(120, perspective - zY);
    const zX = Math.abs(Math.sin(radX)) * halfH;
    const yProj = Math.abs(Math.cos(radX)) * halfH * perspective / Math.max(120, perspective - zX);
    return {
        extraX: Math.max(0, xProj - halfW),
        extraY: Math.max(0, yProj - halfH)
    };
}

function navYieldFromHover(hovered, layout) {
    if (hovered < 0 || !mosaic || !layout) {
        return { x: 0, y: 0 };
    }
    const mosaicRect = geom.mosaic;
    const c = centroid(shardState[hovered].rest);
    const sx = mosaicRect.left + mosaicRect.width * c.x / 100;
    const sy = mosaicRect.top + mosaicRect.height * c.y / 100;
    const nx = layout.left + layout.width / 2;
    const ny = layout.top + layout.height / 2;
    const dx = nx - sx;
    const dy = ny - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const fall = influence(dist, 640);
    const amount = 18 * fall;
    return {
        x: (dx / dist) * amount,
        y: (dy / dist) * amount * 0.55
    };
}

function clampNavMotion(shiftX, shiftY, tiltX, tiltY, layout) {
    const margin = 8;
    const slackL = layout.left - margin;
    const slackR = window.innerWidth - (layout.left + layout.width) - margin;
    const slackT = layout.top - margin;
    const slackB = window.innerHeight - (layout.top + layout.height) - margin;

    let tx = shiftX;
    let ty = shiftY;
    let rx = tiltX;
    let ry = tiltY;

    for (let i = 0; i < 8; i += 1) {
        const extra = tiltOverflow(layout.width, layout.height, rx, ry);
        const needL = extra.extraX + Math.max(0, -tx);
        const needR = extra.extraX + Math.max(0, tx);
        const needT = extra.extraY + Math.max(0, -ty);
        const needB = extra.extraY + Math.max(0, ty);
        const scaleX = Math.min(
            1,
            slackL / Math.max(needL, 0.001),
            slackR / Math.max(needR, 0.001)
        );
        const scaleY = Math.min(
            1,
            slackT / Math.max(needT, 0.001),
            slackB / Math.max(needB, 0.001)
        );
        const scale = Math.min(1, Math.max(0, scaleX), Math.max(0, scaleY));
        if (scale >= 0.995) {
            break;
        }
        tx *= scale;
        ty *= scale;
        rx *= scale;
        ry *= scale;
    }

    const extra = tiltOverflow(layout.width, layout.height, rx, ry);
    const minTx = extra.extraX - slackL;
    const maxTx = slackR - extra.extraX;
    const minTy = extra.extraY - slackT;
    const maxTy = slackB - extra.extraY;
    tx = minTx > maxTx ? (minTx + maxTx) / 2 : clamp(tx, minTx, maxTx);
    ty = minTy > maxTy ? (minTy + maxTy) / 2 : clamp(ty, minTy, maxTy);
    return { tx: tx, ty: ty, rx: rx, ry: ry };
}

function hoveredShardIndex() {
    if (!mosaic || isInfoView() || !allowMorph || reduceMotion) {
        return -1;
    }
    const rect = geom.mosaic;
    if (rect.width < 8 || rect.height < 8) {
        return -1;
    }
    const x = ((state.mouseX - rect.left) / rect.width) * 100;
    const y = ((state.mouseY - rect.top) / rect.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) {
        return -1;
    }
    for (let i = shardState.length - 1; i >= 0; i -= 1) {
        if (pointInPolygon(x, y, shardState[i].rest)) {
            return i;
        }
    }
    return -1;
}

function insetPolygon(points, amount) {
    const c = centroid(points);
    return points.map(function (p) {
        return {
            x: p.x + (c.x - p.x) * amount,
            y: p.y + (c.y - p.y) * amount
        };
    });
}

function hoverShift(hoveredKey) {
    const shift = {};
    if (!hoveredKey || !MASTER[hoveredKey]) {
        return shift;
    }

    const hotPts = MASTER[hoveredKey];
    const c = centroid(hotPts.map(function (p) {
        return { x: p[0], y: p[1] };
    }));

    hotPts.forEach(function (p) {
        const k = vertKey(p);
        const shared = owners[k] && owners[k].length > 1;
        const interior = p[0] > 4 && p[0] < 96 && p[1] > 4 && p[1] < 96;
        if (!shared || !interior) {
            return;
        }
        const dx = p[0] - c.x;
        const dy = p[1] - c.y;
        const len = Math.hypot(dx, dy) || 1;
        shift[k] = {
            x: (dx / len) * PUSH,
            y: (dy / len) * PUSH
        };
    });

    return shift;
}

function morphTargets(hovered) {
    const hoveredKey = hovered >= 0 ? shardState[hovered].key : "";
    const shift = hoverShift(hoveredKey);

    return shardState.map(function (item) {
        const moved = MASTER[item.key].map(function (p) {
            const extra = shift[vertKey(p)];
            return {
                x: p[0] + (extra ? extra.x : 0),
                y: p[1] + (extra ? extra.y : 0)
            };
        });
        return insetPolygon(moved, GAP);
    });
}

const restMorph = shardState.length ? morphTargets(-1) : [];
const hoverMorph = shardState.map(function (_, index) {
    return morphTargets(index);
});

function setHotPane(index) {
    if (state.hotPane === index) {
        return;
    }
    if (state.hotPane >= 0 && shardState[state.hotPane]) {
        shardState[state.hotPane].pane.classList.remove("is-hot");
    }
    state.hotPane = index;
    if (index >= 0 && shardState[index]) {
        shardState[index].pane.classList.add("is-hot");
    }
}

function applyClips(snap) {
    if (!mosaic || isInfoView() || !allowMorph) {
        setHotPane(-1);
        clipsSettled = true;
        return false;
    }
    const rect = geom.mosaic;
    if (rect.width < 8 || rect.height < 8) {
        clipsSettled = true;
        return false;
    }

    const radius = Math.min(rect.width, rect.height) * 0.028;
    const morph = state.hovered >= 0 ? hoverMorph[state.hovered] : restMorph;
    const t = snap || reduceMotion ? 1 : LERP_CLIP;
    let moving = false;

    shardState.forEach(function (item, index) {
        const target = morph[index];
        let itemMoved = false;
        item.current.forEach(function (p, i) {
            const nx = lerp(p.x, target[i].x, t);
            const ny = lerp(p.y, target[i].y, t);
            if (!nearly(nx, p.x, CLIP_SETTLE) || !nearly(ny, p.y, CLIP_SETTLE)) {
                itemMoved = true;
                moving = true;
            }
            p.x = nx;
            p.y = ny;
        });

        if (!itemMoved && item.lastPath && !snap) {
            return;
        }

        const px = item.current.map(function (p) {
            return {
                x: (p.x / 100) * rect.width,
                y: (p.y / 100) * rect.height
            };
        });

        const path = roundedPath(px, radius);
        if (path !== item.lastPath) {
            item.lastPath = path;
            const cssPath = `path("${path}")`;
            item.pane.style.clipPath = cssPath;
            item.pane.style.webkitClipPath = cssPath;
        }
    });

    clipsSettled = !moving;
    return moving;
}

function setVar(meta, name, value) {
    if (meta.css[name] === value) {
        return false;
    }
    meta.css[name] = value;
    meta.pane.style.setProperty(name, value);
    return true;
}

function isExternalProjectHref(href) {
    return /cxd3rev|dilipaints|github\.io\/Rated/i.test(href || "");
}

function setOverlayFocusable(on) {
    if (!infoView) {
        return;
    }
    infoView.querySelectorAll("a, button").forEach(function (el) {
        if (on) {
            el.removeAttribute("tabindex");
        } else {
            el.setAttribute("tabindex", "-1");
        }
    });
}

function lockInfoOverlay() {
    if (!infoView) {
        return;
    }
    document.body.classList.remove("is-info");
    infoView.hidden = true;
    infoView.inert = true;
    infoView.setAttribute("aria-hidden", "true");
    setOverlayFocusable(false);
}

function stripHomeProjectLinks() {
    if (!mosaic) {
        return;
    }
    document.querySelectorAll("a[href]").forEach(function (link) {
        const href = link.getAttribute("href") || "";
        if (!isExternalProjectHref(href)) {
            return;
        }
        link.removeAttribute("href");
        link.setAttribute("tabindex", "-1");
        link.setAttribute("aria-hidden", "true");
        link.style.pointerEvents = "none";
    });
}

stripHomeProjectLinks();
lockInfoOverlay();

if (mosaic) {
    document.addEventListener("click", function (event) {
        const link = event.target.closest("a");
        if (!link) {
            return;
        }
        if (isExternalProjectHref(link.getAttribute("href"))) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}

function enterInfo(name) {
    if (!infoView || !name || name === "work") {
        return;
    }

    const match = infoArticles.find(function (article) {
        return article.dataset.info === name;
    });
    if (!match) {
        return;
    }

    infoArticles.forEach(function (article) {
        article.classList.toggle("is-active", article === match);
    });

    infoView.inert = false;
    infoView.hidden = false;
    infoView.setAttribute("aria-hidden", "false");
    setOverlayFocusable(true);
    document.body.classList.add("is-info");
    window.scrollTo(0, 0);
    invalidateGeometry();
}

function exitInfo() {
    lockInfoOverlay();
    infoArticles.forEach(function (article) {
        article.classList.remove("is-active");
    });
    window.scrollTo(0, 0);
    invalidateGeometry();
}

function pulseGlow(pane) {
    pane.classList.remove("is-glow");
    void pane.offsetWidth;
    pane.classList.add("is-glow");
    window.clearTimeout(pane._glowTimer);
    pane._glowTimer = window.setTimeout(function () {
        pane.classList.remove("is-glow");
    }, GLOW_MS);
}

function requestWork() {
    rafQueued = true;
    if (rafRunning || document.hidden) {
        return;
    }
    rafRunning = true;
    requestAnimationFrame(frame);
}

function applyPaneMotion() {
    let busy = false;
    const tiltScale = reduceMotion ? 0 : 1;

    paneMeta.forEach(function (meta, index) {
        if (!meta.visible) {
            return;
        }

        const rect = meta.rect;
        const item = state.items[index];
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = state.mouseX - centerX;
        const dy = state.mouseY - centerY;
        const distance = Math.hypot(dx, dy);
        const radius = Math.max(rect.width, rect.height) * 0.95;
        const falloff = influence(distance, radius);
        const x = clamp(dx / (rect.width / 2 || 1), -1, 1);
        const y = clamp(dy / (rect.height / 2 || 1), -1, 1);

        item.targetRx = y * 9 * falloff * tiltScale;
        item.targetRy = x * -11 * falloff * tiltScale;
        item.targetHx = lerp(42, ((x + 1) / 2) * 100, falloff);
        item.targetHy = lerp(12, ((y + 1) / 2) * 100, falloff);

        const nextRx = lerp(item.rx, item.targetRx, LERP_TILT);
        const nextRy = lerp(item.ry, item.targetRy, LERP_TILT);
        const nextHx = lerp(item.hx, item.targetHx, LERP_HIGHLIGHT);
        const nextHy = lerp(item.hy, item.targetHy, LERP_HIGHLIGHT);

        if (
            !nearly(nextRx, item.rx) ||
            !nearly(nextRy, item.ry) ||
            !nearly(nextHx, item.hx) ||
            !nearly(nextHy, item.hy)
        ) {
            busy = true;
        }

        item.rx = nextRx;
        item.ry = nextRy;
        item.hx = nextHx;
        item.hy = nextHy;

        if (meta.isNav) {
            const layout = geom.nav;
            const yieldShift = reduceMotion
                ? { x: 0, y: 0 }
                : navYieldFromHover(state.hovered, layout);
            state.navTargetShiftX = yieldShift.x;
            state.navTargetShiftY = yieldShift.y;
            const nextShiftX = lerp(state.navShiftX, state.navTargetShiftX, LERP_NAV);
            const nextShiftY = lerp(state.navShiftY, state.navTargetShiftY, LERP_NAV);
            if (!nearly(nextShiftX, state.navShiftX) || !nearly(nextShiftY, state.navShiftY)) {
                busy = true;
            }
            state.navShiftX = nextShiftX;
            state.navShiftY = nextShiftY;

            const motion = clampNavMotion(
                state.navShiftX,
                state.navShiftY,
                item.rx,
                item.ry,
                layout
            );

            setVar(meta, "--tilt-x", `${motion.rx.toFixed(2)}deg`);
            setVar(meta, "--tilt-y", `${motion.ry.toFixed(2)}deg`);
            setVar(meta, "--shift-x", `${motion.tx.toFixed(2)}px`);
            setVar(meta, "--shift-y", `${motion.ty.toFixed(2)}px`);
            setVar(meta, "--hx", `${item.hx.toFixed(1)}%`);
            setVar(meta, "--hy", `${item.hy.toFixed(1)}%`);
            return;
        }

        setVar(meta, "--tilt-x", `${item.rx.toFixed(2)}deg`);
        setVar(meta, "--tilt-y", `${item.ry.toFixed(2)}deg`);
        setVar(meta, "--hx", `${item.hx.toFixed(1)}%`);
        setVar(meta, "--hy", `${item.hy.toFixed(1)}%`);
    });

    return busy;
}

function logoIsActive(btn) {
    if (infoView && infoView.contains(btn) && infoView.hasAttribute("hidden")) {
        return false;
    }
    return true;
}

function applyLogoMotion() {
    if (!logoButtons.length) {
        return false;
    }

    let busy = false;
    const tiltScale = reduceMotion ? 0 : 1;

    logoButtons.forEach(function (btn) {
        if (!logoIsActive(btn)) {
            return;
        }
        const rect = btn.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
            return;
        }

        const motion = btn._logoMotion || (btn._logoMotion = {
            rx: 0,
            ry: 0,
            targetRx: 0,
            targetRy: 0
        });

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = state.mouseX - centerX;
        const dy = state.mouseY - centerY;
        const distance = Math.hypot(dx, dy);
        const radius = Math.max(rect.width, rect.height) * 1.35;
        const falloff = influence(distance, radius);
        const x = clamp(dx / (rect.width / 2 || 1), -1, 1);
        const y = clamp(dy / (rect.height / 2 || 1), -1, 1);

        motion.targetRx = y * 16 * falloff * tiltScale;
        motion.targetRy = x * -18 * falloff * tiltScale;
        const nextRx = lerp(motion.rx, motion.targetRx, LERP_TILT);
        const nextRy = lerp(motion.ry, motion.targetRy, LERP_TILT);
        if (!nearly(nextRx, motion.rx) || !nearly(nextRy, motion.ry)) {
            busy = true;
        }
        motion.rx = nextRx;
        motion.ry = nextRy;
        btn.style.setProperty("--tilt-x", `${motion.rx.toFixed(2)}deg`);
        btn.style.setProperty("--tilt-y", `${motion.ry.toFixed(2)}deg`);
    });

    return busy;
}

function frame() {
    if (document.hidden) {
        rafRunning = false;
        return;
    }

    rafQueued = false;
    refreshGeometry();

    const nextHover = hoveredShardIndex();
    if (nextHover !== state.hovered) {
        state.hovered = nextHover;
        clipsSettled = false;
    }
    setHotPane(state.hovered);

    const clipsBusy = applyClips(false);
    const motionBusy = applyPaneMotion();
    const logoBusy = applyLogoMotion();
    const busy = clipsBusy || motionBusy || logoBusy || !clipsSettled;

    if (busy || rafQueued) {
        requestAnimationFrame(frame);
        return;
    }

    rafRunning = false;
}

document.addEventListener("mousemove", function (event) {
    state.mouseX = event.clientX;
    state.mouseY = event.clientY;
    requestWork();
}, { passive: true });

window.addEventListener("scroll", invalidateGeometry, { passive: true, capture: true });
window.addEventListener("resize", invalidateGeometry, { passive: true });

document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
        invalidateGeometry();
    }
});

if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(invalidateGeometry);
    if (mosaic) {
        ro.observe(mosaic);
    }
    paneMeta.forEach(function (meta) {
        if (meta.shell) {
            ro.observe(meta.shell);
        } else if (meta.stage) {
            ro.observe(meta.stage);
        }
    });
}

function onMotionPrefChange(event) {
    reduceMotion = event.matches;
    clipsSettled = false;
    requestWork();
}

function onMorphPrefChange(event) {
    allowMorph = event.matches;
    clipsSettled = false;
    if (!allowMorph) {
        shardState.forEach(function (item) {
            item.lastPath = "";
            item.pane.style.clipPath = "";
            item.pane.style.webkitClipPath = "";
        });
        setHotPane(-1);
    }
    requestWork();
}

if (typeof reduceMotionQuery.addEventListener === "function") {
    reduceMotionQuery.addEventListener("change", onMotionPrefChange);
    mosaicMorphQuery.addEventListener("change", onMorphPrefChange);
} else {
    reduceMotionQuery.addListener(onMotionPrefChange);
    mosaicMorphQuery.addListener(onMorphPrefChange);
}

shards.forEach(function (pane) {
    pane.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        pulseGlow(pane);
    });
});

document.querySelectorAll(".nav-links a[data-view]").forEach(function (link) {
    link.addEventListener("click", function (event) {
        const name = link.dataset.view;
        const href = link.getAttribute("href") || "";
        if (name === "work" || href === "work.html") {
            return;
        }
        if (isExternalProjectHref(href)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const match = infoArticles.find(function (article) {
            return article.dataset.info === name;
        });
        if (!match) {
            return;
        }
        event.preventDefault();
        enterInfo(name);
    });
});

if (cornerLobe && infoView) {
    cornerLobe.addEventListener("click", function (event) {
        if (cornerLobe.tagName === "A") {
            return;
        }
        event.preventDefault();
        exitInfo();
    });
}

document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
        return;
    }
    if (isInfoView()) {
        exitInfo();
    } else if (document.body.classList.contains("info-page")) {
        window.location.href = "index.html";
    }
});

document.querySelectorAll(".info-logo-btn").forEach(function (pane) {
    pane.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const logo = pane.querySelector(".info-logo");
        if (!logo || reduceMotion || logo.classList.contains("is-spinning")) {
            return;
        }
        logo.classList.add("is-spinning");
        logo.addEventListener("animationend", function () {
            logo.classList.remove("is-spinning");
        }, { once: true });
    });
});

requestWork();
