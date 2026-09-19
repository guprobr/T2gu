#include "SpriteSheet.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QImage>
#include <QPainter>
#include <QRect>
#include <QTransform>

#include <cmath>

bool SpriteSheet::load(const QString &jsonPath, QString *errorOut)
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
    m_frameWidth = root.value("frameWidth").toInt();
    m_frameHeight = root.value("frameHeight").toDouble();
    // framesPerFacing is a legacy shorthand for equal front/back counts;
    // framesFront/framesBack (if present) override it independently. These
    // are also the grid's reserved column counts - see gutterSlots below.
    const int symmetricFrames = root.value("framesPerFacing").toInt(4);
    m_framesFront = root.value("framesFront").toInt(symmetricFrames);
    m_framesBack = root.value("framesBack").toInt(symmetricFrames);
    m_gutterSlots = root.value("gutterSlots").toInt(0);
    m_frameDurationMs = root.value("frameDurationMs").toInt(120);

    m_rows.clear();
    const QJsonArray rows = root.value("rows").toArray();
    for (const QJsonValue &v : rows) {
        const QJsonObject rowObj = v.toObject();
        Row row;
        row.index = rowObj.value("index").toInt();
        row.framesFront = rowObj.contains("framesFront") ? rowObj.value("framesFront").toInt() : -1;
        row.framesBack = rowObj.contains("framesBack") ? rowObj.value("framesBack").toInt() : -1;
        m_rows.insert(rowObj.value("name").toString(), row);
    }

    if (m_frameWidth <= 0 || m_frameHeight <= 0 || m_rows.isEmpty()) {
        if (errorOut)
            *errorOut = QStringLiteral("incomplete sprite sheet metadata in %1").arg(jsonPath);
        return false;
    }

    const QString sheetFile = root.value("sheet").toString();
    const QString sheetPath = QFileInfo(jsonPath).dir().filePath(sheetFile);
    QImage sheet;
    if (!sheet.load(sheetPath)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot load sheet image %1").arg(sheetPath);
        return false;
    }

    // Scanned as raw bytes: alpha is byte 3 of each pixel for RGBA8888 (in
    // memory order) and for ARGB32 on a little-endian machine (where it's
    // the top byte of the native word), so the common PNG decode needs no
    // conversion of the 181 MB image. Anything else is converted once.
    const bool rgba8888 = sheet.format() == QImage::Format_RGBA8888 || sheet.format() == QImage::Format_RGBA8888_Premultiplied;
    const bool argb32 = sheet.format() == QImage::Format_ARGB32 || sheet.format() == QImage::Format_ARGB32_Premultiplied;
    if (!rgba8888 && !argb32)
        sheet = sheet.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    const int alphaByte = (sheet.format() == QImage::Format_RGBA8888 || sheet.format() == QImage::Format_RGBA8888_Premultiplied
                           || Q_BYTE_ORDER == Q_LITTLE_ENDIAN) ? 3 : 0;

    const int cellHeight = static_cast<int>(std::llround(m_frameHeight));
    auto storage = std::make_shared<Storage>();
    for (auto it = m_rows.constBegin(); it != m_rows.constEnd(); ++it) {
        const Row &row = it.value();
        const int y = static_cast<int>(std::llround(row.index * m_frameHeight));
        for (const Facing facing : { Facing::Front, Facing::Back }) {
            const int count = rowFrameCount(row, facing);
            for (int i = 0; i < count; ++i) {
                const int col = facingOffset(facing) + i;
                const qint64 key = frameKey(row.index, col);
                if (storage->frames.contains(key))
                    continue; // rows sharing an index (or overlapping blocks) share one frame

                // The visible-pixel bounding box of this cell, clipped to
                // the image (a cell hanging off the edge reads as
                // transparent there, same as cropping it would).
                const QRect cell = QRect(col * m_frameWidth, y, m_frameWidth, cellHeight).intersected(sheet.rect());
                int minX = cell.right() + 1, minY = cell.bottom() + 1, maxX = -1, maxY = -1;
                for (int py = cell.top(); py <= cell.bottom(); ++py) {
                    const uchar *line = sheet.constScanLine(py);
                    for (int px = cell.left(); px <= cell.right(); ++px) {
                        if (line[px * 4 + alphaByte] == 0)
                            continue;
                        minX = std::min(minX, px);
                        maxX = std::max(maxX, px);
                        minY = std::min(minY, py);
                        maxY = std::max(maxY, py);
                    }
                }

                Frame frame;
                if (maxX >= minX && maxY >= minY) {
                    const QRect bounds(minX, minY, maxX - minX + 1, maxY - minY + 1);
                    frame.pixmap = QPixmap::fromImage(sheet.copy(bounds));
                    // Relative to the (unclipped) cell's own top-left, which is
                    // what a full-cell pixmap's origin would have been.
                    frame.offset = QPoint(minX - col * m_frameWidth, minY - y);
                }
                storage->frames.insert(key, frame);
            }
        }
    }
    m_storage = storage; // the sheet itself goes out of scope here and is freed

    return true;
}

int SpriteSheet::rowFrameCount(const Row &row, Facing facing) const
{
    const int override_ = (facing == Facing::Front) ? row.framesFront : row.framesBack;
    if (override_ > 0)
        return override_;
    return (facing == Facing::Front) ? m_framesFront : m_framesBack;
}

int SpriteSheet::facingOffset(Facing facing) const
{
    return (facing == Facing::Front) ? 0 : (m_framesFront + m_gutterSlots);
}

int SpriteSheet::frameCount(const QString &movement, Facing facing) const
{
    if (!m_rows.contains(movement))
        return 0;
    return rowFrameCount(m_rows.value(movement), facing);
}

QSize SpriteSheet::cellSize() const
{
    return QSize(m_frameWidth, static_cast<int>(std::llround(m_frameHeight)));
}

namespace {
// Where the character's feet sit, as a fraction of the frame cell's own
// height. Each cell is now the *margin-expanded, then uniformly shrunk-to-
// fit* canvas baked in by tools/refit_sprites.py (extra room on every side
// so even a wide weapon-swing or sprawled pose isn't clipped, then scaled
// down and bottom-anchored to fit the existing frame size - see that
// script's own comment for why the margin is the same for every character
// rather than tuned per character), not a tight crop - so this isn't a
// number close to 1.0 the way a tightly-cropped sprite's would be. Re-
// measured directly off the current sheets (lowest non-transparent row of
// each character's own idle frame, as a fraction of its cell height)
// across the full 135-character roster after refit_sprites.py: median
// 0.832. This must be re-measured (and this constant updated) any time
// refit_sprites.py's margin or the shrink-to-fit logic changes, since a
// bigger/smaller margin directly shifts where the bottom-anchored content
// actually lands.
constexpr qreal kNominalFeetFraction = 0.83;

// Where the character's own visible content actually starts (its head,
// roughly), as a fraction of the cell height - the mirror-image measurement
// of kNominalFeetFraction above, needed because refit_sprites.py's bottom-
// anchoring leaves real empty margin above the character too, not just
// below. Re-measured the same way (topmost non-transparent row of each
// character's idle frame) across the full roster: median 0.543.
constexpr qreal kNominalTopFraction = 0.54;
}

qreal SpriteSheet::feetFraction() const
{
    return kNominalFeetFraction;
}

qreal SpriteSheet::topFraction() const
{
    return kNominalTopFraction;
}

SpriteSheet::Frame SpriteSheet::frame(const QString &movement, int frameIndex, Facing facing, bool mirrored) const
{
    const int count = frameCount(movement, facing);
    if (count <= 0)
        return {};

    const Row &row = m_rows.value(movement);
    const int col = facingOffset(facing) + (frameIndex % count);
    const qint64 key = frameKey(row.index, col);

    const auto found = m_storage->frames.constFind(key);
    if (found == m_storage->frames.constEnd())
        return {};
    if (!mirrored || found->pixmap.isNull())
        return found.value();

    // Mirroring the cell flips the trimmed pixels in place and moves the
    // offset to the opposite side.
    const auto cached = m_storage->mirrored.constFind(key);
    if (cached != m_storage->mirrored.constEnd())
        return cached.value();
    Frame flipped;
    flipped.pixmap = found->pixmap.transformed(QTransform().scale(-1, 1));
    flipped.offset = QPoint(m_frameWidth - (found->offset.x() + found->pixmap.width()), found->offset.y());
    m_storage->mirrored.insert(key, flipped);
    return flipped;
}

QPixmap SpriteSheet::paddedFrame(const QString &movement, int frameIndex, Facing facing) const
{
    const Frame trimmed = frame(movement, frameIndex, facing);
    if (frameCount(movement, facing) <= 0)
        return {};

    QPixmap cell(cellSize());
    cell.fill(Qt::transparent);
    if (!trimmed.pixmap.isNull()) {
        QPainter painter(&cell);
        painter.drawPixmap(trimmed.offset, trimmed.pixmap);
    }
    return cell;
}
