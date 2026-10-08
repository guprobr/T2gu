#include "ui/StatusMessageWidget.h"

#include <QFontMetrics>
#include <QPainter>
#include <QPainterPath>
#include <algorithm>

namespace {
// ~3.5s on screen in total: fully opaque for kHoldMs, then fading. The
// "Level Up!" caption is gone in 1.3s, which is fine for two words drawn
// over the hero but too quick for a line like "Picked up: Bramble Crown"
// read in the corner of the eye mid-fight.
constexpr qint64 kHoldMs = 2600;
constexpr qint64 kFadeMs = 900;
// A pack dying to one fireball plus its loot can post several lines in one
// tick; beyond this many the oldest go first, so the box stays a glance and
// never grows down over the play field.
constexpr int kMaxLines = 5;
constexpr int kAnimIntervalMs = 33;
constexpr int kPadX = 16;
constexpr int kPadY = 8;
constexpr int kLineSpacing = 2;

QColor colorFor(GameScene::StatusKind kind)
{
    switch (kind) {
    case GameScene::StatusKind::Loot:
        return QColor(0xd4, 0xaf, 0x37); // the gold every other HUD panel uses for names/borders
    case GameScene::StatusKind::Victory:
        return QColor(0xa8, 0xe6, 0xa1);
    case GameScene::StatusKind::Loss:
        return QColor(0xff, 0x6b, 0x6b);
    case GameScene::StatusKind::Progress:
        return QColor(0x9f, 0xd3, 0xff); // SelectionInfoWidget's stat-line blue
    }
    return Qt::white;
}

qreal opacityAt(qint64 ageMs)
{
    if (ageMs <= kHoldMs)
        return 1.0;
    return std::clamp(1.0 - qreal(ageMs - kHoldMs) / kFadeMs, 0.0, 1.0);
}

QFont statusFont(const QFont &base)
{
    QFont font = base;
    font.setPixelSize(16);
    font.setBold(true);
    return font;
}
}

StatusMessageWidget::StatusMessageWidget(QWidget *parent)
    : QWidget(parent)
{
    setAttribute(Qt::WA_TransparentForMouseEvents, true); // click-to-select must still reach the scene below
    setFocusPolicy(Qt::NoFocus); // MainWindow handles every key
    setFont(statusFont(font()));
    m_animTimer.setSingleShot(true);
    connect(&m_animTimer, &QTimer::timeout, this, &StatusMessageWidget::expireAndAnimate);
    hide();
}

void StatusMessageWidget::post(const QString &text, GameScene::StatusKind kind)
{
    // The same event again while its line is still fully shown (three
    // skeletons cut down in one swing, two coins in a row) counts up on that
    // line instead of stacking identical copies of it.
    if (!m_lines.isEmpty()) {
        Line &last = m_lines.last();
        if (last.text == text && last.kind == kind && last.age.elapsed() <= kHoldMs) {
            last.repeats++;
            last.age.restart();
            relayout();
            update();
            scheduleNextAnimation();
            return;
        }
    }

    Line line{ text, kind, 1, {} };
    line.age.start();
    m_lines.append(line);
    while (m_lines.size() > kMaxLines)
        m_lines.removeFirst();

    relayout();
    show();
    raise();
    update();
    scheduleNextAnimation();
}

void StatusMessageWidget::setLayoutBounds(int top, int maxWidth)
{
    m_top = top;
    m_maxWidth = maxWidth;
    relayout();
}

void StatusMessageWidget::expireAndAnimate()
{
    const qsizetype before = m_lines.size();
    m_lines.erase(std::remove_if(m_lines.begin(), m_lines.end(),
                                 [](const Line &line) { return line.age.elapsed() >= kHoldMs + kFadeMs; }),
                  m_lines.end());

    if (m_lines.isEmpty()) {
        m_animTimer.stop();
        hide();
        return;
    }
    const bool removedLines = m_lines.size() != before;
    if (removedLines)
        relayout();
    const bool fading = std::any_of(m_lines.cbegin(), m_lines.cend(),
                                   [](const Line &line) { return line.age.elapsed() > kHoldMs; });
    if (removedLines || fading)
        update();
    scheduleNextAnimation();
}

void StatusMessageWidget::scheduleNextAnimation()
{
    if (m_lines.isEmpty()) {
        m_animTimer.stop();
        return;
    }

    // Opaque lines do not change between posts. Repainting them at 30 Hz
    // can needlessly upload widget content and compose the OpenGL window.
    // Wake at the earliest fade boundary; animate only while a line fades.
    qint64 nextMs = kHoldMs + 1;
    for (const Line &line : std::as_const(m_lines)) {
        const qint64 ageMs = line.age.elapsed();
        nextMs = std::min(nextMs, ageMs > kHoldMs ? qint64(kAnimIntervalMs)
                                                : kHoldMs - ageMs + 1);
    }
    // Frequent new/repeated posts must not keep postponing older fades.
    const int remainingMs = m_animTimer.remainingTime();
    if (remainingMs >= 0 && remainingMs <= nextMs)
        return;
    m_animTimer.start(int(nextMs));
}

QString StatusMessageWidget::displayText(const Line &line) const
{
    return line.repeats > 1 ? QStringLiteral("%1  ×%2").arg(line.text).arg(line.repeats) : line.text;
}

void StatusMessageWidget::relayout()
{
    if (!parentWidget())
        return;

    const QFontMetrics metrics(font());
    int textWidth = 0;
    for (const Line &line : std::as_const(m_lines))
        textWidth = std::max(textWidth, metrics.horizontalAdvance(displayText(line)));

    const int width = std::min(textWidth + 2 * kPadX, m_maxWidth);
    const int lineCount = int(m_lines.size());
    const int height = 2 * kPadY + lineCount * metrics.height() + std::max(0, lineCount - 1) * kLineSpacing;
    setGeometry((parentWidget()->width() - width) / 2, m_top, width, height);
}

void StatusMessageWidget::paintEvent(QPaintEvent *)
{
    if (m_lines.isEmpty())
        return;

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    // The box fades with its most visible line, so a lone line fading out
    // takes the box with it instead of leaving an empty frame behind.
    qreal boxOpacity = 0.0;
    for (const Line &line : std::as_const(m_lines))
        boxOpacity = std::max(boxOpacity, opacityAt(line.age.elapsed()));

    QPainterPath box;
    box.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 6, 6);
    painter.fillPath(box, QColor(10, 10, 20, int(200 * boxOpacity)));
    QColor border(0xd4, 0xaf, 0x37);
    border.setAlphaF(0.8 * boxOpacity);
    painter.setPen(QPen(border, 1.5));
    painter.drawPath(box);

    const QFontMetrics metrics(font());
    const int textWidth = width() - 2 * kPadX;
    int y = kPadY;
    for (const Line &line : std::as_const(m_lines)) {
        QColor color = colorFor(line.kind);
        color.setAlphaF(opacityAt(line.age.elapsed()));
        painter.setPen(color);
        painter.drawText(QRect(kPadX, y, textWidth, metrics.height()), Qt::AlignCenter,
                         metrics.elidedText(displayText(line), Qt::ElideRight, textWidth));
        y += metrics.height() + kLineSpacing;
    }
}
