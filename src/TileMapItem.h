#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QHash>
#include <QObject>
#include <array>

#include "TileMap.h"

// Paints an entire TileMap (base layer then obj layer) in one paint() call
// instead of one QGraphicsPixmapItem per tile - the map is static, so
// there's nothing per-tile that needs to be a separate scene item.
//
// The one exception is water: instead of an animated sprite sheet, the pure
// water tile gets a lightweight per-frame ripple done with pixel tricks -
// the tile is sliced into thin horizontal stripes and each stripe is redrawn
// with a small horizontal offset from a sine wave. The phase is keyed on
// world Y (not tile-local y) plus elapsed time, so ripples stay continuous
// across tile boundaries and keep moving over time. QObject is needed here
// for Q_INTERFACES/qgraphicsitem_cast, and was originally also used for an
// independent repaint QTimer - that timer's been removed (see tick()):
// driving the invalidation from GameScene's own single, already-throttled
// tick loop instead of a second free-running timer avoids the two
// interacting unpredictably (their independent, unsynchronized firings
// were implicated in a real, measured periodic stutter - see tick()).
//
// A large field of one "pure" terrain (tileset index 0 or 9, per the fixed
// 10-tile blob-autotile convention every real tileset follows - see
// assets/tilesets/*.json) is otherwise the exact same 128x128 image drawn
// hundreds of times with zero variation. Rather than requiring brand new
// art per terrain, each pure tile gets 3 free extra looks via exact pixel
// mirroring (horizontal flip, vertical flip, both = 180 deg) - visually
// distinct, seamless with the original (a flip of a tileable texture still
// tiles), and free of any new asset. Which of the 4 orientations lands on
// a given cell is chosen with 2-octave coherent value noise (see
// variantIndexFor() in the .cpp) rather than independent per-cell
// randomness, so like-oriented tiles cluster into soft patches instead of
// a "salt and pepper" scatter - that clustering is the "fractal" part.
// Blob transition tiles (indices 1-8) are directional by design (a north
// edge, a corner) and are never touched by this - mirroring one would
// silently turn it into the wrong shape and break the seam it exists for.
class TileMapItem : public QObject, public QGraphicsItem
{
    Q_OBJECT
    Q_INTERFACES(QGraphicsItem)

public:
    explicit TileMapItem(const TileMap &map, QGraphicsItem *parent = nullptr);

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

    // Called from GameScene::onTick() (see its own call site) rather than
    // driven by an independent QTimer - invalidates just the visible
    // portion of the map (see VisibleSceneRect.h) at most once every
    // kAnimIntervalMs, using m_clock the same way it always has for the
    // ripple's own phase.
    void tick();

private:
    void paintRippledWaterTile(QPainter *painter, const QPixmap &tile, qreal worldX, qreal worldY) const;
    // Returns the mirrored variant of `index` (which must be a pure tile,
    // i.e. 0 or 9) picked for (col, row), computing and caching all 4
    // orientations for that index the first time it's requested.
    QPixmap variantTileFor(int index, int col, int row);

    const TileMap &m_map;
    int m_waterTileIndex = -1;
    QElapsedTimer m_clock;
    qint64 m_lastUpdateMs = 0;
    QHash<int, std::array<QPixmap, 4>> m_variantCache;
};
