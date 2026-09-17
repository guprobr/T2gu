#include "Character.h"

#include <QBrush>
#include <QGraphicsRectItem>
#include <QImage>
#include <QPainter>
#include <QPen>
#include <QRadialGradient>
#include <QRandomGenerator>
#include <QTransform>
#include <algorithm>
#include <cmath>

#include "TileMap.h"

namespace {
constexpr qreal kWhistleMinIntervalSeconds = 20.0;
constexpr qreal kWhistleMaxIntervalSeconds = 45.0;

qreal randomWhistleInterval()
{
    return kWhistleMinIntervalSeconds
            + QRandomGenerator::global()->generateDouble() * (kWhistleMaxIntervalSeconds - kWhistleMinIntervalSeconds);
}

// "Coherent intervals": long enough that this reads as an occasional
// shuffle/shift-of-weight, not fidgeting - short enough that a standing
// NPC doesn't feel frozen either.
constexpr qreal kWanderMinIntervalSeconds = 3.5;
constexpr qreal kWanderMaxIntervalSeconds = 7.0;
constexpr qreal kWanderBurstMinSeconds = 0.5;
constexpr qreal kWanderBurstMaxSeconds = 1.0;
constexpr qreal kWanderSpeed = 90.0; // px/s - a gentle amble, well under any real walk speed
// How far from "home" (wherever wandering was enabled) before the next
// burst is aimed back toward it instead of picked randomly - keeps a
// long-idling NPC from slowly drifting away over many small steps.
constexpr qreal kWanderLeashPx = 100.0;

qreal randomWanderInterval()
{
    return kWanderMinIntervalSeconds
            + QRandomGenerator::global()->generateDouble() * (kWanderMaxIntervalSeconds - kWanderMinIntervalSeconds);
}

qreal randomWanderBurst()
{
    return kWanderBurstMinSeconds
            + QRandomGenerator::global()->generateDouble() * (kWanderBurstMaxSeconds - kWanderBurstMinSeconds);
}
}

Character::Character(SpriteSheet sheet, QGraphicsItem *parent)
    : QGraphicsPixmapItem(parent)
    , m_sheet(std::move(sheet))
    , m_whistleCooldown(randomWhistleInterval())
{
    updatePixmap();
}

void Character::paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget)
{
    // A soft, flattened ground-contact shadow drawn once per frame right
    // before the sprite itself - one QRadialGradient + one drawEllipse()
    // call, the same "a translucent gradient fill IS per-pixel alpha
    // blending, done by the rasterizer in one call" reasoning
    // LightingOverlayItem already relies on, not real per-pixel work. Drawn
    // in a scaled/translated local coordinate space so the gradient itself
    // comes out properly elliptical rather than a circle clipped to an
    // ellipse (which would fade unevenly along the two axes).
    const QPointF anchor = feetOffset();
    // Capped, not just scaled - a couple of oversized/atypical sprites
    // shouldn't get a shadow blob out of proportion with everyone else's.
    // The cap is doubled again along with the character roster's own extra
    // 2x pass (see tools/upscale_2x.py, re-run solo for characters after
    // tools/refit_sprites.py's shrink-to-fit made them read as too small) -
    // boundingRect().width() auto-scales with the now-bigger sprites, but a
    // stale cap would clamp nearly every normal character's shadow down to
    // its old, now-way-too-small pixel size.
    const qreal shadowRadius = std::min(boundingRect().width() * 0.28, 136.0);
    constexpr qreal kShadowSquash = 0.42; // vertical flatten ratio

    QRadialGradient gradient(QPointF(0, 0), shadowRadius);
    gradient.setColorAt(0.0, QColor(0, 0, 0, 100));
    gradient.setColorAt(0.7, QColor(0, 0, 0, 55));
    gradient.setColorAt(1.0, QColor(0, 0, 0, 0));

    painter->save();
    painter->setRenderHint(QPainter::Antialiasing, true);
    painter->translate(anchor + m_shadowOffset);
    painter->scale(1.0, kShadowSquash);
    painter->setPen(Qt::NoPen);
    painter->setBrush(gradient);
    painter->drawEllipse(QPointF(0, 0), shadowRadius, shadowRadius);
    painter->restore();

    QGraphicsPixmapItem::paint(painter, option, widget);
}

void Character::setVelocity(QPointF pixelsPerSecond)
{
    if (isActing())
        return;

    m_velocity = pixelsPerSecond;

    // Vertical movement picks the camera-facing block; horizontal movement
    // mirrors whichever block is active. When vertical movement dominates
    // (including straight down), facing goes back to Front - there's no
    // dedicated down-facing art, Front doubles as "facing the camera."
    if (std::abs(m_velocity.y()) >= std::abs(m_velocity.x()) && m_velocity.y() < 0)
        m_facing = SpriteSheet::Facing::Back;
    else if (m_velocity.y() != 0.0)
        m_facing = SpriteSheet::Facing::Front;

    if (m_velocity.x() < 0)
        m_mirrorLeft = true;
    else if (m_velocity.x() > 0)
        m_mirrorLeft = false;
}

QPointF Character::feetOffset() const
{
    // Bottom-center of whatever frame is currently showing, pulled up to
    // wherever the sheet says the ground-contact point actually is rather
    // than assuming it's flush with the sprite's bottom edge - frame() may
    // pad the pixmap with extra margin above/below the character (see
    // SpriteSheet::feetFraction()), so that point isn't always at a fixed
    // fraction of the raw frame height.
    const QRectF r = boundingRect();
    return QPointF(r.width() / 2.0, r.height() * m_sheet.feetFraction());
}

QPixmap Character::portraitPixmap() const
{
    const QPixmap frame = m_sheet.frame(QStringLiteral("idle"), 0, SpriteSheet::Facing::Front);
    if (frame.isNull())
        return frame;

    // Direct scanline access (not QImage::pixelColor(), which re-does
    // colorspace/format handling per pixel) - this only runs once per
    // selection, not per frame, but there's no reason to make even an
    // occasional call needlessly slow over ~570k pixels.
    const QImage img = frame.toImage().convertToFormat(QImage::Format_ARGB32);
    int minX = img.width(), minY = img.height(), maxX = -1, maxY = -1;
    for (int y = 0; y < img.height(); ++y) {
        const QRgb *line = reinterpret_cast<const QRgb *>(img.constScanLine(y));
        for (int x = 0; x < img.width(); ++x) {
            if (qAlpha(line[x]) > 10) {
                minX = std::min(minX, x);
                maxX = std::max(maxX, x);
                minY = std::min(minY, y);
                maxY = std::max(maxY, y);
            }
        }
    }
    if (maxX < minX || maxY < minY)
        return frame; // fully transparent frame (shouldn't happen) - fall back to the raw cell

    constexpr int kMargin = 12;
    const int x0 = std::max(0, minX - kMargin);
    const int y0 = std::max(0, minY - kMargin);
    const int x1 = std::min(img.width(), maxX + 1 + kMargin);
    const int y1 = std::min(img.height(), maxY + 1 + kMargin);
    return frame.copy(x0, y0, x1 - x0, y1 - y0);
}

bool Character::isBlocked(qreal worldX, qreal worldY) const
{
    if (m_tileMap && !m_tileMap->isWalkable(worldX, worldY))
        return true;
    if (m_blockingAreas && m_blockingAreas->containsPoint(worldX, worldY))
        return true;
    return false;
}

bool Character::isWithinMeleeReach(QPointF targetFeetPos, qreal reach) const
{
    const QPointF delta = targetFeetPos - feetPos();
    return (delta.x() * delta.x() + delta.y() * delta.y()) <= reach * reach;
}

void Character::triggerAttack()
{
    if (m_dead || isActing())
        return;
    startAction(QStringLiteral("attack"));
}

void Character::triggerSkill()
{
    if (m_dead || isActing())
        return;
    startAction(QStringLiteral("skill"));
}

void Character::applyDamage(int amount)
{
    if (m_dead || m_maxHp <= 0)
        return;

    m_hp = std::max(0, m_hp - amount);
    updateHealthBar();

    if (m_hp == 0) {
        m_dead = true;
        m_velocity = QPointF(0, 0);
        startAction(QStringLiteral("die"));
    } else {
        startAction(QStringLiteral("hit"));
    }
}

void Character::heal(int amount)
{
    if (m_dead || m_maxHp <= 0)
        return;

    m_hp = std::min(m_maxHp, m_hp + amount);
    updateHealthBar();
}

bool Character::consumeWhistlePending()
{
    if (m_whistleCooldown > 0.0)
        return false;
    m_whistleCooldown = randomWhistleInterval();
    return true;
}

void Character::setWanderEnabled(bool enabled)
{
    m_wanderEnabled = enabled;
    if (enabled && !m_wanderHomeSet) {
        m_wanderHome = pos();
        m_wanderHomeSet = true;
        m_wanderCooldown = randomWanderInterval();
    }
}

void Character::tickIdleWander(qreal dtSeconds)
{
    if (m_wanderBurstRemaining > 0.0) {
        m_wanderBurstRemaining -= dtSeconds;
        if (m_wanderBurstRemaining <= 0.0)
            setVelocity(QPointF(0.0, 0.0));
        return;
    }

    m_wanderCooldown -= dtSeconds;
    if (m_wanderCooldown > 0.0)
        return;

    m_wanderCooldown = randomWanderInterval();
    m_wanderBurstRemaining = randomWanderBurst();

    const QPointF fromHome = pos() - m_wanderHome;
    const qreal distanceFromHome = std::hypot(fromHome.x(), fromHome.y());
    QPointF direction;
    if (distanceFromHome > kWanderLeashPx) {
        // Wandered far enough already - head back toward home instead of
        // picking a fresh random direction, so a long-idling NPC re-centers
        // over the next few bursts rather than drifting further away.
        direction = QPointF(-fromHome.x() / distanceFromHome, -fromHome.y() / distanceFromHome);
    } else {
        static const QPointF kCardinalDirections[4] = { QPointF(0, -1), QPointF(0, 1), QPointF(-1, 0), QPointF(1, 0) };
        direction = kCardinalDirections[QRandomGenerator::global()->bounded(4)];
    }

    setVelocity(QPointF(direction.x() * kWanderSpeed, direction.y() * kWanderSpeed));
}

void Character::setMaxHp(int hp)
{
    m_maxHp = hp;
    m_hp = hp;
    ensureHealthBar();
    updateHealthBar();
}

void Character::setCurrentHp(int hp)
{
    if (m_maxHp <= 0)
        return;
    m_hp = std::clamp(hp, 0, m_maxHp);
    m_dead = (m_hp == 0); // matches applyDamage()'s own invariant, without its animation/sound
    updateHealthBar();
}

void Character::ensureHealthBar()
{
    if (m_healthBarBg)
        return;

    const QRectF r = boundingRect();
    // Doubled again along with the character roster's own extra 2x pass
    // (see tools/upscale_2x.py's upscale_character_sheets(), re-run solo
    // for characters after tools/refit_sprites.py's shrink-to-fit made them
    // read as too small) so the bar stays proportionally visible against
    // the now-bigger sprite rather than reading as a thin sliver.
    m_healthBarFullWidth = 160.0;
    constexpr qreal barHeight = 20.0;
    const qreal barX = r.width() / 2.0 - m_healthBarFullWidth / 2.0;
    // Just above the character's own head - NOT the sprite's top edge
    // (y=0): refit_sprites.py bottom-anchors each character's content
    // within its cell, leaving real empty margin above it (see
    // SpriteSheet::topFraction()), so y=0 is well above the actual head
    // now and a bar positioned relative to it would float with a large,
    // wrong-looking gap.
    constexpr qreal kGapAboveHead = 40.0;
    const qreal barY = r.height() * m_sheet.topFraction() - kGapAboveHead - barHeight;

    m_healthBarBg = new QGraphicsRectItem(QRectF(barX, barY, m_healthBarFullWidth, barHeight), this);
    m_healthBarBg->setBrush(Qt::black);
    m_healthBarBg->setPen(Qt::NoPen);

    m_healthBarFill = new QGraphicsRectItem(QRectF(barX, barY, m_healthBarFullWidth, barHeight), this);
    m_healthBarFill->setBrush(Qt::green);
    m_healthBarFill->setPen(Qt::NoPen);
}

void Character::setHealthBarVisible(bool visible)
{
    m_healthBarVisible = visible;
    updateHealthBar();
}

void Character::updateHealthBar()
{
    if (!m_healthBarFill)
        return;

    const bool shown = !m_dead && m_healthBarVisible;
    m_healthBarBg->setVisible(shown);
    m_healthBarFill->setVisible(shown);
    if (!shown)
        return;

    const qreal ratio = m_maxHp > 0 ? qreal(m_hp) / m_maxHp : 0.0;
    QRectF r = m_healthBarFill->rect();
    r.setWidth(m_healthBarFullWidth * ratio);
    m_healthBarFill->setRect(r);
    m_healthBarFill->setBrush(ratio <= 0.3 ? Qt::red : Qt::green);
}

void Character::startAction(const QString &movement)
{
    if (!m_sheet.hasMovement(movement))
        return; // generated art incomplete for this character - skip the animation, damage/death state still applies

    m_actionMovement = movement;
    m_actionFrame = 0;
    m_actionElapsed = 0.0;
    m_velocity = QPointF(0, 0);
    updatePixmap();
}

void Character::tickAction(qreal dtSeconds)
{
    m_actionElapsed += dtSeconds * 1000.0;
    const int duration = m_sheet.frameDurationMs();
    if (duration > 0 && m_actionElapsed >= duration) {
        m_actionElapsed -= duration;
        m_actionFrame++;
    }

    const int totalFrames = m_sheet.frameCount(m_actionMovement, m_facing);
    if (m_actionFrame >= totalFrames) {
        if (m_dead) {
            m_actionFrame = std::max(0, totalFrames - 1); // freeze on the last die frame forever
        } else {
            m_actionMovement.clear();
            m_actionFrame = 0;
            m_actionElapsed = 0.0;
        }
    }
}

void Character::tick(qreal dtSeconds)
{
    // Ticked unconditionally - even mid-action or dead - so a buff never
    // outlives its stated duration just because its owner happened to be
    // swinging/dying when it should have expired.
    if (m_tempStrengthRemaining > 0.0) {
        m_tempStrengthRemaining -= dtSeconds;
        if (m_tempStrengthRemaining <= 0.0) {
            m_tempStrengthRemaining = 0.0;
            m_tempBonusStrength = 0;
        }
    }
    if (m_tempIntelligenceRemaining > 0.0) {
        m_tempIntelligenceRemaining -= dtSeconds;
        if (m_tempIntelligenceRemaining <= 0.0) {
            m_tempIntelligenceRemaining = 0.0;
            m_tempBonusIntelligence = 0;
        }
    }
    if (m_tempSpeedRemaining > 0.0) {
        m_tempSpeedRemaining -= dtSeconds;
        if (m_tempSpeedRemaining <= 0.0) {
            m_tempSpeedRemaining = 0.0;
            m_tempBonusSpeed = 0;
        }
    }

    if (isActing()) {
        tickAction(dtSeconds);
        updatePixmap();
        return;
    }

    if (m_dead) {
        updatePixmap();
        return;
    }

    m_whistleCooldown -= dtSeconds; // only counts down while alive and not mid-action, on purpose

    // Before the movement integration below, so a burst this call decides
    // to start is picked up by that same integration this frame instead of
    // lagging a frame behind.
    if (m_wanderEnabled)
        tickIdleWander(dtSeconds);

    const bool moving = m_velocity.x() != 0.0 || m_velocity.y() != 0.0;

    if (moving) {
        const QPointF feet = feetOffset();
        const QPointF delta(m_velocity.x() * dtSeconds, m_velocity.y() * dtSeconds);

        qreal newX = x() + delta.x();
        qreal newY = y() + delta.y();

        if (isBlocked(newX + feet.x(), y() + feet.y()))
            newX = x();
        if (isBlocked(newX + feet.x(), newY + feet.y()))
            newY = y();

        setPos(newX, newY);

        m_frameElapsed += dtSeconds * 1000.0;
        const int duration = m_sheet.frameDurationMs();
        if (duration > 0 && m_frameElapsed >= duration) {
            m_frameElapsed -= duration;
            m_frame++;
        }
    } else {
        m_frame = 0;
        m_frameElapsed = 0.0;
    }

    updatePixmap();
}

void Character::updatePixmap()
{
    QString movement;
    int frameIndex;

    if (isActing()) {
        movement = m_actionMovement;
        frameIndex = m_actionFrame;
    } else {
        const bool moving = m_velocity.x() != 0.0 || m_velocity.y() != 0.0;
        if (moving && m_running && m_sheet.hasMovement(QStringLiteral("run")))
            movement = QStringLiteral("run");
        else
            movement = moving ? QStringLiteral("walk") : QStringLiteral("idle");
        frameIndex = m_frame;
    }

    QPixmap frame = m_sheet.frame(movement, frameIndex, m_facing);
    if (m_mirrorLeft)
        frame = frame.transformed(QTransform().scale(-1, 1));

    setPixmap(frame);

    // Depth-sort by ground-contact Y (world coordinates) rather than a fixed
    // stacking order: a character standing "above" (smaller world Y than) a
    // prop's own base is drawn behind it, one standing "below" is drawn in
    // front. Recomputed every call (idle or moving) since boundingRect() -
    // and so feetOffset() - can change size across the pixmap just set above.
    //
    // A corpse (frozen forever on its last die frame - see tickAction())
    // doesn't get this Y-based treatment: it's meant to read as a flat mark
    // on the ground, not a standing sprite competing in the depth-sort, so
    // any living character walking near or over it should always draw on
    // top regardless of exactly how their feet-Y compares to where this one
    // died. A fixed value just above the tile map layer (see GameScene::
    // loadLevel(), zValue -10) achieves that unconditionally: it's
    // comfortably below any living character's own Y-based zValue, which
    // starts at feetOffset() alone (already hundreds of pixels) even for a
    // character standing at the very top of a map.
    constexpr qreal kCorpseZValue = -5.0;
    setZValue(m_dead ? kCorpseZValue : y() + feetOffset().y());
}
