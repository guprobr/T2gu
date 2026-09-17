#pragma once

#include <QElapsedTimer>
#include <QGraphicsItem>
#include <QObject>
#include <QPointF>
#include <QTimer>

class QGraphicsScene;

// A traveling bolt of fire cast by a sufficiently intelligent Character -
// see GameScene::castFireball(). Purely a visual effect: it animates its
// own position/fade on an internal timer and self-removes once done, the
// same "self-contained, parentless-so-it-can-travel-in-scene-space, always
// deletes itself" pattern LevelUpTextItem uses for its own animation. The
// actual damage and hit timing are owned separately by GameScene's own
// tick-driven bookkeeping (see PendingFireballHit) so gameplay never
// depends on this item's timer firing in perfect lockstep - a dropped
// frame here only ever costs a little visual smoothness, never a hit.
class FireballItem : public QObject, public QGraphicsItem
{
    Q_OBJECT
    Q_INTERFACES(QGraphicsItem)

public:
    // `intelligence` drives the bolt's brightness/size the same way it
    // drives GameScene's own damage/cooldown formulas (see
    // fireballDamageFor()/fireballCooldownFor() in GameScene.cpp) - a
    // stronger caster's fireball reads as visibly stronger, not just
    // numerically so.
    FireballItem(QGraphicsScene *scene, QPointF start, QPointF end, qreal durationSeconds, int intelligence);

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QPointF m_localEnd; // m_end - m_start, i.e. the travel delta in this item's own local space
    qreal m_durationMs;
    qreal m_impactDurationMs;
    qreal m_glowRadius;
    int m_coreAlpha;
    QElapsedTimer m_clock;
    QTimer m_timer;
};
