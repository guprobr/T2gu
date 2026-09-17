#include "TileSheet.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>

#include <QJsonValue>

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
    m_tileWidth = root.value("tileWidth").toInt();
    m_tileHeight = root.value("tileHeight").toInt();
    m_columns = root.value("columns").toInt(1);

    const QString sheetFile = root.value("sheet").toString();
    const QString sheetPath = QFileInfo(jsonPath).dir().filePath(sheetFile);
    if (!m_sheet.load(sheetPath)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot load tileset image %1").arg(sheetPath);
        return false;
    }

    if (m_tileWidth <= 0 || m_tileHeight <= 0 || m_columns <= 0) {
        if (errorOut)
            *errorOut = QStringLiteral("incomplete tileset metadata in %1").arg(jsonPath);
        return false;
    }

    m_namedTiles.clear();
    const QJsonObject namedTiles = root.value("tiles").toObject();
    for (auto it = namedTiles.constBegin(); it != namedTiles.constEnd(); ++it)
        m_namedTiles.insert(it.key(), it.value().toInt());

    return true;
}

QPixmap TileSheet::tile(int index) const
{
    if (index < 0)
        return {};

    const int col = index % m_columns;
    const int row = index / m_columns;
    return m_sheet.copy(col * m_tileWidth, row * m_tileHeight, m_tileWidth, m_tileHeight);
}
