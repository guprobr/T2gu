#pragma once

#include <QGraphicsItem>
#include <QObject>
#include <QPointF>

class QGraphicsScene;

// A traveling bolt of fire cast by a sufficiently intelligent Character -
// see GameScene::castFireball(). GameScene advances this visual and its
// damage together using simulation time. The endpoint follows the original
// target until impact, then stays fixed while the flash fades. Scene
// ownership handles teardown; GameScene removes completed/cancelled bolts.
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

    void setTargetPosition(QPointF end);
    void tick(qreal dtSeconds);
    bool isFinished() const { return m_elapsedMs >= m_durationMs + m_impactDurationMs; }

    QRectF boundingRect() const override;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget) override;

private:
    QPointF m_localEnd; // m_end - m_start, i.e. the travel delta in this item's own local space
    qreal m_durationMs;
    qreal m_impactDurationMs;
    qreal m_glowRadius;
    int m_coreAlpha;
    qreal m_elapsedMs = 0.0;
};
