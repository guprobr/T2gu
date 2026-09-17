#pragma once

#include <QHash>
#include <QPixmap>
#include <QString>

// A grid tileset image: tiles are indexed row-major, tileIndex = row *
// columns + col. Loaded from a JSON sidecar (tile size, column count) next
// to the PNG, same convention as SpriteSheet. Tiles may also carry a name
// (e.g. "water") so map logic like collision doesn't have to hardcode
// numeric indices that only mean something by looking at the artwork.
class TileSheet
{
public:
    bool load(const QString &jsonPath, QString *errorOut = nullptr);

    QPixmap tile(int index) const;
    int tileWidth() const { return m_tileWidth; }
    int tileHeight() const { return m_tileHeight; }

    // Returns -1 if no tile has this name.
    int indexByName(const QString &name) const { return m_namedTiles.value(name, -1); }

private:
    QPixmap m_sheet;
    int m_tileWidth = 0;
    int m_tileHeight = 0;
    int m_columns = 1;
    QHash<QString, int> m_namedTiles;
};
