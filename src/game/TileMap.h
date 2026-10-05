#pragma once

#include <QString>
#include <QPointF>
#include <QVector>

#include "assets/TileSheet.h"

// A simple two-layer tile map: "base" (ground - grass, path, water) and
// "obj" (things drawn on top that block movement - trees, rocks; -1 means
// empty). Loaded from a JSON file that also points at the TileSheet it
// draws tiles from.
class TileMap
{
public:
    // Transactional: invalid dimensions, grids or dependencies retain the previous map.
    bool load(const QString &jsonPath, QString *errorOut = nullptr);

    int widthInTiles() const { return m_width; }
    int heightInTiles() const { return m_height; }
    int tileWidth() const { return m_tileWidth; }
    int tileHeight() const { return m_tileHeight; }
    qreal pixelWidth() const { return qreal(m_width) * m_tileWidth; }
    qreal pixelHeight() const { return qreal(m_height) * m_tileHeight; }

    int baseAt(int col, int row) const;
    int objAt(int col, int row) const;
    const TileSheet &tileSheet() const { return m_tileSheet; }
    quint64 tilesetRevision() const { return m_tilesetRevision; }

    // Swaps which TileSheet the base/obj grids are drawn from, in place -
    // the grids themselves (and every index they contain) are untouched, so
    // this only works because every generated tileset shares the same index
    // layout convention (pure terrain at 0/9, transitions at 1-8).
    // Art cell size is independent of map spacing (shipped art is 256 px
    // on a 128 px map grid). Only water-named terrain blocks movement.
    // Lets a script re-skin a loaded map (e.g. a season change) without
    // rebuilding it. Path is resolved the same way "tileset" in the map
    // JSON is: relative to the map file's own directory.
    bool loadTileset(const QString &tilesetRelPath, QString *errorOut = nullptr);
    // Checks an axis-aligned feet-point movement, including crossed tiles.
    bool isAxisMoveWalkable(QPointF from, QPointF to) const;

    // Overwrites a single base-layer cell in place - e.g. a script draining
    // a pond tile-by-tile, or revealing a bridge. No-op for invalid coordinates or tile indices.
    void setBaseTile(int col, int row, int index);

    // True if the point (in scene/world pixel coordinates) is on the map
    // and not blocked by water or an obj tile.
    bool isWalkable(qreal worldX, qreal worldY) const;

private:
    QString m_baseDir; // the map JSON's own directory, for resolving loadTileset()'s relative path
    TileSheet m_tileSheet;
    int m_width = 0;
    int m_height = 0;
    int m_tileWidth = 128;
    int m_tileHeight = 128;
    QVector<int> m_base;
    QVector<int> m_obj;
    int m_waterTileIndex = -1;
    quint64 m_tilesetRevision = 0;
};
