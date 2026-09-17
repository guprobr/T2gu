#include "SpriteSheet.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

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

    const QString sheetFile = root.value("sheet").toString();
    const QString sheetPath = QFileInfo(jsonPath).dir().filePath(sheetFile);
    if (!m_sheet.load(sheetPath)) {
        if (errorOut)
            *errorOut = QStringLiteral("cannot load sheet image %1").arg(sheetPath);
        return false;
    }

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

    return true;
}

int SpriteSheet::frameCount(const QString &movement, Facing facing) const
{
    if (!m_rows.contains(movement))
        return 0;
    const Row &row = m_rows.value(movement);
    const int override_ = (facing == Facing::Front) ? row.framesFront : row.framesBack;
    if (override_ > 0)
        return override_;
    return (facing == Facing::Front) ? m_framesFront : m_framesBack;
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

QPixmap SpriteSheet::frame(const QString &movement, int frameIndex, Facing facing) const
{
    const int count = frameCount(movement, facing);
    if (count <= 0)
        return {};

    const Row &row = m_rows.value(movement);
    // The Back block starts after the sheet's reserved Front columns plus
    // its blank gutter columns - a fixed offset shared by every row, even
    // if this particular row doesn't animate through all its Front slots.
    const int facingOffset = (facing == Facing::Front) ? 0 : (m_framesFront + m_gutterSlots);
    const int col = facingOffset + (frameIndex % count);

    // The result only depends on (row, col), and the source sheet never
    // changes after load, so cache it rather than re-copying the same
    // region out of m_sheet every time a non-animating frame is requested.
    const qint64 cacheKey = (static_cast<qint64>(row.index) << 32) | static_cast<quint32>(col);
    const auto cached = m_frameCache.constFind(cacheKey);
    if (cached != m_frameCache.constEnd())
        return cached.value();

    const int cellHeight = static_cast<int>(std::llround(m_frameHeight));
    const int x = col * m_frameWidth;
    const int y = static_cast<int>(std::llround(row.index * m_frameHeight));

    const QPixmap cropped = m_sheet.copy(x, y, m_frameWidth, cellHeight);
    m_frameCache.insert(cacheKey, cropped);
    return cropped;
}
