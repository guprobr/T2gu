#include "TileMap.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <algorithm>
#include <cmath>
#include <utility>

namespace {
constexpr int kMaxMapDimension = 4096;
constexpr qint64 kMaxMapCells = 1024 * 1024;
constexpr qint64 kMaxMapJsonBytes = 32 * 1024 * 1024;

bool positiveInteger(const QJsonValue &value, int &out, int defaultValue = 0)
{
    if (value.isUndefined() && defaultValue > 0) {
        out = defaultValue;
        return true;
    }
    if (!value.isDouble())
        return false;
    const double number = value.toDouble();
    if (!std::isfinite(number) || number < 1 || number > kMaxMapDimension || std::floor(number) != number)
        return false;
    out = static_cast<int>(number);
    return true;
}

bool readGrid(const QJsonValue &value, int width, int height, int tileCount, QVector<int> &out)
{
    if (!value.isArray() || value.toArray().size() != height)
        return false;
    out.reserve(width * height);
    const QJsonArray rows = value.toArray();
    for (const QJsonValue &entry : rows) {
        if (!entry.isArray() || entry.toArray().size() != width)
            return false;
        const QJsonArray row = entry.toArray();
        for (const QJsonValue &tile : row) {
            if (!tile.isDouble())
                return false;
            const double index = tile.toDouble();
            if (!std::isfinite(index) || std::floor(index) != index || index < -1 || index >= tileCount)
                return false;
            out.append(static_cast<int>(index));
        }
    }
    return true;
}
}

bool TileMap::load(const QString &jsonPath, QString *errorOut)
{
    auto fail = [errorOut, &jsonPath](const QString &message) {
        if (errorOut)
            *errorOut = QStringLiteral("%1 in %2").arg(message, jsonPath);
        return false;
    };
    QFile file(jsonPath);
    if (!file.open(QIODevice::ReadOnly))
        return fail(QStringLiteral("cannot open map"));
    if (file.size() > kMaxMapJsonBytes)
        return fail(QStringLiteral("map JSON exceeds 32 MiB limit"));

    QJsonParseError parseError;
    const QJsonDocument doc = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError)
        return fail(parseError.errorString());
    if (!doc.isObject())
        return fail(QStringLiteral("map must be a JSON object"));

    const QJsonObject root = doc.object();
    TileMap candidate;
    // Grid spacing and artwork cell sizes are intentionally independent.
    if (!positiveInteger(root.value("width"), candidate.m_width)
            || !positiveInteger(root.value("height"), candidate.m_height)
            || !positiveInteger(root.value("tileWidth"), candidate.m_tileWidth, 128)
            || !positiveInteger(root.value("tileHeight"), candidate.m_tileHeight, 128)
            || qint64(candidate.m_width) * candidate.m_height > kMaxMapCells)
        return fail(QStringLiteral("invalid or oversized map dimensions"));

    candidate.m_baseDir = QFileInfo(jsonPath).dir().path();
    const QString tilesetRelPath = root.value("tileset").toString();
    if (tilesetRelPath.isEmpty())
        return fail(QStringLiteral("missing tileset path"));
    if (!candidate.loadTileset(tilesetRelPath, errorOut))
        return false;

    const int tileCount = candidate.m_tileSheet.tileCount();
    if (!readGrid(root.value("base"), candidate.m_width, candidate.m_height, tileCount, candidate.m_base))
        return fail(QStringLiteral("invalid base grid shape or tile index"));
    if (root.value("obj").isUndefined())
        candidate.m_obj.fill(-1, candidate.m_width * candidate.m_height);
    else if (!readGrid(root.value("obj"), candidate.m_width, candidate.m_height, tileCount, candidate.m_obj))
        return fail(QStringLiteral("invalid object grid shape or tile index"));

    candidate.m_tilesetRevision = m_tilesetRevision + 1;
    *this = std::move(candidate);
    return true;
}

bool TileMap::loadTileset(const QString &tilesetRelPath, QString *errorOut)
{
    const QString tilesetPath = QDir(m_baseDir).filePath(tilesetRelPath);
    TileSheet candidate;
    if (!candidate.load(tilesetPath, errorOut))
        return false;

    const auto indexFits = [&candidate](int index) { return index >= -1 && index < candidate.tileCount(); };
    if (!std::all_of(m_base.cbegin(), m_base.cend(), indexFits)
            || !std::all_of(m_obj.cbegin(), m_obj.cend(), indexFits)) {
        if (errorOut)
            *errorOut = QStringLiteral("replacement tileset cannot represent existing map indices");
        return false;
    }
    m_tileSheet = std::move(candidate);
    m_waterTileIndex = m_tileSheet.indexByName(QStringLiteral("water"));
    ++m_tilesetRevision;
    return true;
}

void TileMap::setBaseTile(int col, int row, int index)
{
    if (col < 0 || row < 0 || col >= m_width || row >= m_height || index < -1 || index >= m_tileSheet.tileCount())
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
    if (!std::isfinite(worldX) || !std::isfinite(worldY) || m_tileWidth <= 0 || m_tileHeight <= 0
            || worldX < 0.0 || worldY < 0.0 || worldX >= pixelWidth() || worldY >= pixelHeight())
        return false;
    const int col = static_cast<int>(worldX / m_tileWidth);
    const int row = static_cast<int>(worldY / m_tileHeight);

    if (col < 0 || row < 0 || col >= m_width || row >= m_height)
        return false;

    if (objAt(col, row) != -1)
        return false;

    if (m_waterTileIndex != -1 && baseAt(col, row) == m_waterTileIndex)
        return false;

    return true;
}

bool TileMap::isAxisMoveWalkable(QPointF from, QPointF to) const
{
    Q_ASSERT(from.x() == to.x() || from.y() == to.y());
    if (!isWalkable(to.x(), to.y()))
        return false;
    // Preserve stepping out of a newly blocked starting tile, but no
    // other blocked tile can be crossed. Check bounds before conversion.
    if (!std::isfinite(from.x()) || !std::isfinite(from.y())
            || from.x() < 0.0 || from.y() < 0.0 || from.x() >= pixelWidth() || from.y() >= pixelHeight())
        return false;
    const int fromCol = int(from.x() / m_tileWidth), fromRow = int(from.y() / m_tileHeight);
    const int toCol = int(to.x() / m_tileWidth), toRow = int(to.y() / m_tileHeight);
    for (int row = std::min(fromRow, toRow); row <= std::max(fromRow, toRow); ++row) {
        for (int col = std::min(fromCol, toCol); col <= std::max(fromCol, toCol); ++col) {
            if (col == fromCol && row == fromRow)
                continue;
            if (objAt(col, row) != -1 || (m_waterTileIndex >= 0 && baseAt(col, row) == m_waterTileIndex))
                return false;
        }
    }
    return true;
}
