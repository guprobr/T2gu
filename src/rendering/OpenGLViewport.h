#pragma once

#ifdef T2GU_HAS_OPENGL
#include <QOpenGLWidget>
#include <QOpenGLTimerQuery>
#include <QGraphicsScene>
#include <QPointer>
#include <QVector>
#include <array>
#include <memory>

// Optional diagnostics use public Qt composition signals. frameSwapped is
// completion of Qt's window submission, not a compositor/scanout timestamp.
class OpenGLViewport final : public QOpenGLWidget
{
public:
    OpenGLViewport();
    ~OpenGLViewport() override;
    bool beginScenePaint(QGraphicsScene *scene);
    void endScenePaint();

protected:
    void initializeGL() override;

private:
    enum Phase { ScenePaint, PaintToCompose, ComposeToSwap, SwapInterval, GpuScene, PhaseCount };
    struct Samples { QVector<double> wall, cpu; };
    struct Query {
        std::unique_ptr<QOpenGLTimerQuery> timer;
        bool pending = false;
        quint64 generation = 0;
        quint64 frame = 0;
    };
    static qint64 cpuNs();
    void append(Phase phase, qint64 wallNs, qint64 cpuNs = -1);
    void aboutToComposeProfile();
    void frameSwappedProfile();
    void releaseQueries();
    void report(qint64 now);
    const bool m_profile;
    const bool m_bindBeforePaint;
    const bool m_pollResults;
    std::array<Samples, PhaseCount> m_samples;
    std::array<Query, 8> m_queries;
    QPointer<QGraphicsScene> m_scene;
    quint64 m_runtimeGeneration = 0;
    quint64 m_generation = 0;
    quint64 m_frames = 0;
    qint64 m_reportNs = 0;
    qint64 m_paintNs = -1, m_paintCpuNs = -1;
    qint64 m_paintEndNs = -1, m_paintEndCpuNs = -1;
    qint64 m_composeNs = -1, m_composeCpuNs = -1;
    qint64 m_swapNs = -1;
    int m_activeQuery = -1;
    int m_nextMarkerQuery = 0;
    int m_queryBegins = 0;
    int m_querySkips = 0;
    int m_contextBinds = 0;
    quint64 m_maxQueryLag = 0;
};
#endif
