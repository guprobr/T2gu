#include "assets/TileSheet.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>

#include <QJsonValue>
#include <utility>

bool TileSheet::load(const QString &jsonPath, QString *errorOut)
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
    const int tileWidth = root.value("tileWidth").toInt();
    const int tileHeight = root.value("tileHeight").toInt();
    const int columns = root.value("columns").toInt(1);

    if (tileWidth <= 0 || tileHeight <= 0 || columns <= 0) {
        if (errorOut)
            *errorOut = QStringLiteral("incomplete tileset metadata in %1").arg(jsonPath);
        return false;
    }

    const QString sheetFile = root.value("sheet").toString();
    const QString sheetPath = QFileInfo(jsonPath).dir().filePath(sheetFile);
    QPixmap sheet;
    if (!sheet.load(sheetPath)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot load tileset image %1").arg(sheetPath);
        return false;
    }

    if (sheet.width() % tileWidth != 0 || sheet.height() % tileHeight != 0
            || sheet.width() / tileWidth != columns) {
        if (errorOut)
            *errorOut = QStringLiteral("tileset image dimensions disagree with metadata in %1").arg(jsonPath);
        return false;
    }

    QHash<QString, int> names;
    const qint64 tileCount = qint64(columns) * (sheet.height() / tileHeight);
    const QJsonObject namedTiles = root.value("tiles").toObject();
    for (auto it = namedTiles.constBegin(); it != namedTiles.constEnd(); ++it) {
        const int index = it.value().toInt(-1);
        if (index < 0 || index >= tileCount) {
            if (errorOut)
                *errorOut = QStringLiteral("invalid named tile %1 in %2").arg(it.key(), jsonPath);
            return false;
        }
        names.insert(it.key(), index);
    }

    m_tileWidth = tileWidth;
    m_tileHeight = tileHeight;
    m_columns = columns;
    m_sheet = std::move(sheet);
    m_tileCache.clear();
    m_namedTiles = std::move(names);

    return true;
}

QPixmap TileSheet::tile(int index) const
{
    if (index < 0 || index >= tileCount())
        return {};

    const auto cached = m_tileCache.constFind(index);
    if (cached != m_tileCache.cend())
        return cached.value();

    const int col = index % m_columns;
    const int row = index / m_columns;
    const QPixmap tile = m_sheet.copy(col * m_tileWidth, row * m_tileHeight, m_tileWidth, m_tileHeight);
    m_tileCache.insert(index, tile);
    return tile;
}
