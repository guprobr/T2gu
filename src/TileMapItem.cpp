#include "TileMapItem.h"

#include <QImage>
#include <QPainter>
#include <QStyleOptionGraphicsItem>
#include <algorithm>
#include <cmath>

#include "VisibleSceneRect.h"

namespace {
// Subtle ripple - no need for a full 60Hz repaint just for this.
//
// This timer's own update() used to be a bare, argument-less call, which
// implicitly dirties the item's WHOLE boundingRect - the entire map, for
// this item - forcing Qt to reconsider every other visible item underneath
// it too, every 60ms, regardless of how much of the map was actually on
// screen. Measured to compound badly with several actively-moving/
// animating party members on screen (see GameScene::updatePartyAI()): a
// real soak test with 3 active companions showed frame cost climbing
// ~2.6x over a 150s session. Raising this interval (to 320ms at one point)
// masked the symptom but didn't address the actual bug - an update() this
// size doesn't get cheaper just because it happens less often, and it was
// only ever going to get worse on a bigger map. The real fix is
// visibleSceneRectFor() (see VisibleSceneRect.h, used in the constructor
// below): dirty only what's currently on screen, the same way paint()
// below already limits its own drawing to it. With that in place this can
// go back to its original, visually-motivated interval. Doubled per
// request (purely decorative - the ripple reads just as well at half the
// update rate, and it's cheaper besides).
constexpr int kAnimIntervalMs = 120;
// Doubled along with the 2x asset scale (see tools/upscale_2x.py), so the
// stripe thickness/wobble amplitude stay proportional to the now-bigger
// tiles rather than shrinking to a thinner-looking ripple. kRippleTimeSpeed
// is time-based (radians/sec), not spatial, so it's left alone.
// kRippleSpatialFreq is a per-*pixel* rate, not a distance - since a tile
// now spans twice as many pixels, it's halved to keep the same number of
// ripple cycles per tile rather than doubling the visual frequency.
constexpr int kRippleStripeHeightPx = 8;
constexpr qreal kRippleAmplitudePx = 3.0;
constexpr qreal kRippleTimeSpeed = 1.6;     // radians/sec
constexpr qreal kRippleSpatialFreq = 0.08;  // radians per world pixel of Y

// Every real tileset (assets/tilesets/*.json) is a fixed 10-tile blob-
// autotile sheet: index 0 is terrain A pure, index 9 is terrain B pure, and
// 1-8 are the directional edge/corner blends between them. Only the two
// pure indices are eligible for the mirrored-variant treatment below.
bool isPureTerrainIndex(int index) { return index == 0 || index == 9; }

// Cheap deterministic hash -> a float in [0, 1). Same (x, y, seed) always
// gives the same value, so variant selection is stable across repaints and
// reloads of the same map without storing anything.
quint32 hash2D(int x, int y, quint32 seed)
{
    quint32 h = seed;
    h ^= quint32(x) * 0x27d4eb2fu;
    h ^= quint32(y) * 0x165667b1u;
    h = (h ^ (h >> 15)) * 0x85ebca6bu;
    h = (h ^ (h >> 13)) * 0xc2b2ae35u;
    h ^= (h >> 16);
    return h;
}

qreal hashFloat(int x, int y, quint32 seed)
{
    return (hash2D(x, y, seed) & 0xFFFFFFu) / qreal(0xFFFFFFu);
}

qreal smoothstep(qreal t) { return t * t * (3.0 - 2.0 * t); }

// Bilinear-interpolated value noise over the integer hash grid - smooth,
// not the hard per-cell scatter a plain per-cell dice roll would give.
qreal valueNoise(qreal x, qreal y, quint32 seed)
{
    const int x0 = int(std::floor(x));
    const int y0 = int(std::floor(y));
    const qreal sx = smoothstep(x - x0);
    const qreal sy = smoothstep(y - y0);

    const qreal n00 = hashFloat(x0, y0, seed);
    const qreal n10 = hashFloat(x0 + 1, y0, seed);
    const qreal n01 = hashFloat(x0, y0 + 1, seed);
    const qreal n11 = hashFloat(x0 + 1, y0 + 1, seed);

    const qreal ix0 = n00 + (n10 - n00) * sx;
    const qreal ix1 = n01 + (n11 - n01) * sx;
    return ix0 + (ix1 - ix0) * sy;
}

// Two octaves summed (classic fractal Brownian motion, just kept cheap and
// small) - gives soft multi-tile patches of similar variant rather than
// single-frequency noise, which is what actually reads as "less uniform"
// instead of "static-y".
qreal fractalNoise(qreal x, qreal y, quint32 seed)
{
    qreal total = 0.0;
    qreal amplitude = 1.0;
    qreal frequency = 1.0;
    qreal maxAmplitude = 0.0;
    for (int octave = 0; octave < 2; ++octave) {
        total += valueNoise(x * frequency, y * frequency, seed + quint32(octave) * 101u) * amplitude;
        maxAmplitude += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return total / maxAmplitude;
}

// Low spatial frequency (period of several tiles) is what makes the result
// read as coherent patches instead of tile-by-tile noise.
constexpr qreal kVarianceNoiseScale = 0.18;

int variantIndexFor(int index, int col, int row)
{
    const qreal n = fractalNoise(col * kVarianceNoiseScale, row * kVarianceNoiseScale, quint32(index) * 7919u + 1u);
    return std::min(3, int(n * 4.0));
}
}

TileMapItem::TileMapItem(const TileMap &map, QGraphicsItem *parent)
    : QObject(nullptr)
    , QGraphicsItem(parent)
    , m_map(map)
    , m_waterTileIndex(map.tileSheet().indexByName(QStringLiteral("water")))
{
    // Without this flag, QStyleOptionGraphicsItem::exposedRect always
    // defaults to the item's full boundingRect (the whole map), regardless
    // of what's actually visible on screen - paint() below relies on a
    // real, viewport-limited exposedRect to avoid redrawing every tile in
    // the map on every repaint.
    setFlag(QGraphicsItem::ItemUsesExtendedStyleOption, true);
    m_clock.start();
}

void TileMapItem::tick()
{
    const qint64 nowMs = m_clock.elapsed();
    if (nowMs - m_lastUpdateMs < kAnimIntervalMs)
        return;
    m_lastUpdateMs = nowMs;
    // Only the currently-visible portion, not the whole map - see
    // VisibleSceneRect.h for why a bare update() here is the wrong call on
    // an item this size.
    update(visibleSceneRectFor(this));
}

QRectF TileMapItem::boundingRect() const
{
    return QRectF(0, 0, m_map.pixelWidth(), m_map.pixelHeight());
}

void TileMapItem::paintRippledWaterTile(QPainter *painter, const QPixmap &tile, qreal worldX, qreal worldY) const
{
    const int tw = tile.width();
    const int th = tile.height();
    const qreal t = m_clock.elapsed() / 1000.0 * kRippleTimeSpeed;

    painter->save();
    painter->setClipRect(QRectF(worldX, worldY, tw, th));
    for (int y = 0; y < th; y += kRippleStripeHeightPx) {
        const int stripeHeight = std::min(kRippleStripeHeightPx, th - y);
        const qreal phase = t + (worldY + y) * kRippleSpatialFreq;
        const int xOffset = qRound(std::sin(phase) * kRippleAmplitudePx);

        const QRectF stripeSrc(0, y, tw, stripeHeight);
        painter->drawPixmap(QPointF(worldX + xOffset, worldY + y), tile, stripeSrc);
        // The tile tiles seamlessly with itself, so whichever edge the shift
        // exposed gets filled by drawing the same stripe again one tile
        // width over - a second real copy of the water rather than a gap.
        if (xOffset > 0)
            painter->drawPixmap(QPointF(worldX + xOffset - tw, worldY + y), tile, stripeSrc);
        else if (xOffset < 0)
            painter->drawPixmap(QPointF(worldX + xOffset + tw, worldY + y), tile, stripeSrc);
    }
    painter->restore();
}

QPixmap TileMapItem::variantTileFor(int index, int col, int row)
{
    auto it = m_variantCache.find(index);
    if (it == m_variantCache.end()) {
        const QPixmap base = m_map.tileSheet().tile(index);
        const QImage baseImage = base.toImage();
        std::array<QPixmap, 4> variants;
        variants[0] = base;
        variants[1] = QPixmap::fromImage(baseImage.flipped(Qt::Horizontal));
        variants[2] = QPixmap::fromImage(baseImage.flipped(Qt::Vertical));
        variants[3] = QPixmap::fromImage(baseImage.flipped(Qt::Horizontal | Qt::Vertical));
        it = m_variantCache.insert(index, variants);
    }
    return it.value()[variantIndexFor(index, col, row)];
}

void TileMapItem::paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *)
{
    // Clipped to a generously PADDED version of option->exposedRect, not
    // the whole map. Drawing every tile every paint was fine when maps
    // were "a few hundred tiles" (the original comment's own assumption,
    // now stale) - the whole-map remodels pushed real maps to 11,700-
    // 18,360 tiles, and this function draws each one twice (base + obj
    // layers) on every repaint. The animation timer alone (see the
    // constructor) forces a full repaint ~17 times/sec regardless of
    // whether anything moved, so at full-map size this was the dominant
    // per-frame cost in the engine - far larger than the per-character
    // collision-check cost fixed separately (see BlockingGrid.h).
    //
    // The original reason for NOT clipping was real, not paranoia:
    // restricting to the exact exposedRect left stale character pixels on
    // screen whenever more than one move happened between two actual
    // paints. Padding the exposed rect by several tiles in every
    // direction (rather than dropping the clip entirely) addresses that
    // the same way - any plausible amount of missed movement between two
    // real paints is far smaller than this margin - while still cutting
    // the drawn tile count by roughly two orders of magnitude on a large
    // map, since only the viewport's own visible area (plus padding) is
    // ever exposed at once regardless of total map size.
    constexpr int kPaddingTiles = 4;
    const int tw = m_map.tileWidth();
    const int th = m_map.tileHeight();
    const int cols = m_map.widthInTiles();
    const int rowsCount = m_map.heightInTiles();

    const QRectF exposed = option ? option->exposedRect : boundingRect();
    const int colStart = std::max(0, int(std::floor(exposed.left() / tw)) - kPaddingTiles);
    const int colEnd = std::min(cols - 1, int(std::ceil(exposed.right() / tw)) + kPaddingTiles);
    const int rowStart = std::max(0, int(std::floor(exposed.top() / th)) - kPaddingTiles);
    const int rowEnd = std::min(rowsCount - 1, int(std::ceil(exposed.bottom() / th)) + kPaddingTiles);

    for (int row = rowStart; row <= rowEnd; ++row) {
        for (int col = colStart; col <= colEnd; ++col) {
            const int baseIndex = m_map.baseAt(col, row);
            if (baseIndex < 0)
                continue;
            const QPixmap tile = isPureTerrainIndex(baseIndex) ? variantTileFor(baseIndex, col, row)
                                                                : m_map.tileSheet().tile(baseIndex);
            if (m_waterTileIndex != -1 && baseIndex == m_waterTileIndex)
                paintRippledWaterTile(painter, tile, col * tw, row * th);
            else
                painter->drawPixmap(col * tw, row * th, tile);
        }
    }
    for (int row = rowStart; row <= rowEnd; ++row) {
        for (int col = colStart; col <= colEnd; ++col) {
            const int objIndex = m_map.objAt(col, row);
            if (objIndex >= 0)
                painter->drawPixmap(col * tw, row * th, m_map.tileSheet().tile(objIndex));
        }
    }
}
