#include "TileMap.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

namespace {
QVector<int> readGrid(const QJsonArray &rows, int width, int height)
{
    QVector<int> out(width * height, -1);
    for (int y = 0; y < rows.size() && y < height; ++y) {
        const QJsonArray row = rows[y].toArray();
        for (int x = 0; x < row.size() && x < width; ++x)
            out[y * width + x] = row[x].toInt(-1);
    }
    return out;
}
}

bool TileMap::load(const QString &jsonPath, QString *errorOut)
{
    QFile file(jsonPath);
    if (!file.open(QIODevice::ReadOnly)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot open %1").arg(jsonPath);
        return false;
    }

    QJsonParseError parseError;
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError) {
        if (errorOut)
            *errorOut = parseError.errorString();
        return false;
    }

    const QJsonObject root = doc.object();
    m_width = root.value("width").toInt();
    m_height = root.value("height").toInt();
    // Doubled along with the 2x asset scale (see tools/upscale_2x.py) -
    // every real map JSON now sets this field explicitly, so this default
    // is a fallback for a hypothetical map that omits it, kept consistent
    // with the current grid-step convention rather than the pre-2x one.
    m_tileWidth = root.value("tileWidth").toInt(128);
    m_tileHeight = root.value("tileHeight").toInt(128);

    if (m_width <= 0 || m_height <= 0) {
        if (errorOut)
            *errorOut = QStringLiteral("invalid map dimensions in %1").arg(jsonPath);
        return false;
    }

    m_baseDir = QFileInfo(jsonPath).dir().path();

    const QString tilesetRelPath = root.value("tileset").toString();
    if (!loadTileset(tilesetRelPath, errorOut))
        return false;

    m_base = readGrid(root.value("base").toArray(), m_width, m_height);
    m_obj = readGrid(root.value("obj").toArray(), m_width, m_height);

    return true;
}

bool TileMap::loadTileset(const QString &tilesetRelPath, QString *errorOut)
{
    const QString tilesetPath = QDir(m_baseDir).filePath(tilesetRelPath);
    if (!m_tileSheet.load(tilesetPath, errorOut))
        return false;

    m_waterTileIndex = m_tileSheet.indexByName(QStringLiteral("water"));
    return true;
}

void TileMap::setBaseTile(int col, int row, int index)
{
    if (col < 0 || row < 0 || col >= m_width || row >= m_height)
        return;
    m_base[row * m_width + col] = index;
}

int TileMap::baseAt(int col, int row) const
{
    if (col < 0 || row < 0 || col >= m_width || row >= m_height)
        return -1;
    return m_base[row * m_width + col];
}

int TileMap::objAt(int col, int row) const
{
    if (col < 0 || row < 0 || col >= m_width || row >= m_height)
        return -1;
    return m_obj[row * m_width + col];
}

bool TileMap::isWalkable(qreal worldX, qreal worldY) const
{
    const int col = static_cast<int>(worldX) / m_tileWidth;
    const int row = static_cast<int>(worldY) / m_tileHeight;

    if (col < 0 || row < 0 || col >= m_width || row >= m_height)
        return false;

    if (objAt(col, row) != -1)
        return false;

    if (m_waterTileIndex != -1 && baseAt(col, row) == m_waterTileIndex)
        return false;

    return true;
}
