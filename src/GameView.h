#pragma once

#include <QGraphicsView>
#include <QElapsedTimer>
#include <QVector>

#include "PaintMetrics.h"

// Renderer selection is a launch-time option. Gameplay and chrome widgets
// continue to use the same view/scene regardless of its viewport backend.
class GameView : public QGraphicsView
{
public:
    // Call before QApplication: Qt can initialize the driver during startup.
    static void configureRendererEnvironment();
    explicit GameView(QWidget *parent = nullptr);
    bool usesOpenGL() const { return m_usesOpenGL; }

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    void useSoftwareViewport();
    void recordPaint(qint64 startedNs, qint64 finishedNs);
    bool m_usesOpenGL = false;
    QElapsedTimer m_profileClock;
    qint64 m_previousPaintNs = -1;
    qint64 m_profileReportNs = 0;
    QVector<double> m_paintDurations;
    QVector<double> m_paintIntervals;
    PaintMetrics::Frame m_profileTotals;
};
