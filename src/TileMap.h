#pragma once

#include <QString>
#include <QVector>

#include "TileSheet.h"

// A simple two-layer tile map: "base" (ground - grass, path, water) and
// "obj" (things drawn on top that block movement - trees, rocks; -1 means
// empty). Loaded from a JSON file that also points at the TileSheet it
// draws tiles from.
class TileMap
{
public:
    bool load(const QString &jsonPath, QString *errorOut = nullptr);

    int widthInTiles() const { return m_width; }
    int heightInTiles() const { return m_height; }
    int tileWidth() const { return m_tileWidth; }
    int tileHeight() const { return m_tileHeight; }
    qreal pixelWidth() const { return m_width * m_tileWidth; }
    qreal pixelHeight() const { return m_height * m_tileHeight; }

    int baseAt(int col, int row) const;
    int objAt(int col, int row) const;
    const TileSheet &tileSheet() const { return m_tileSheet; }

    // Swaps which TileSheet the base/obj grids are drawn from, in place -
    // the grids themselves (and every index they contain) are untouched, so
    // this only works because every generated tileset shares the same index
    // layout convention (grass is always index 0, the named "water" tile
    // always exists, etc.) per the shared autotile generation pipeline.
    // Lets a script re-skin a loaded map (e.g. a season change) without
    // rebuilding it. Path is resolved the same way "tileset" in the map
    // JSON is: relative to the map file's own directory.
    bool loadTileset(const QString &tilesetRelPath, QString *errorOut = nullptr);

    // Overwrites a single base-layer cell in place - e.g. a script draining
    // a pond tile-by-tile, or revealing a bridge. No-op if out of bounds.
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
};
