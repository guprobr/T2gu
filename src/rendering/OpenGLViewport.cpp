#include "rendering/OpenGLViewport.h"

#ifdef T2GU_HAS_OPENGL
#include "app/RuntimeMetrics.h"
#include <QGuiApplication>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QScreen>
#include <QWindow>

OpenGLViewport::OpenGLViewport()
    : m_profile(qEnvironmentVariableIntValue("T2GU_PROFILE_PRESENT") == 1)
    , m_bindBeforePaint(qEnvironmentVariableIntValue("T2GU_PROFILE_PRESENT_PREBIND") == 1)
    , m_pollResults(qEnvironmentVariable("T2GU_PROFILE_PRESENT_POLL").trimmed() != QLatin1String("0"))
{
    if (m_profile) {
        connect(this, &QOpenGLWidget::aboutToCompose, this, &OpenGLViewport::aboutToComposeProfile);
        connect(this, &QOpenGLWidget::frameSwapped, this, &OpenGLViewport::frameSwappedProfile);
    }
}

OpenGLViewport::~OpenGLViewport()
{
    // The base destructor destroys the context after our members are gone.
    if (context())
        disconnect(context(), &QOpenGLContext::aboutToBeDestroyed, this, &OpenGLViewport::releaseQueries);
    releaseQueries();
}

qint64 OpenGLViewport::cpuNs()
{
#ifdef Q_OS_LINUX
    return RuntimeMetrics::threadCpuNs();
#else
    return -1;
#endif
}

void OpenGLViewport::initializeGL()
{
    QOpenGLFunctions *functions = context()->functions();
    qInfo().nospace() << "T2gu renderer: opengl; vendor="
                     << reinterpret_cast<const char *>(functions->glGetString(GL_VENDOR))
                     << "; device="
                     << reinterpret_cast<const char *>(functions->glGetString(GL_RENDERER))
                     << "; version="
                     << reinterpret_cast<const char *>(functions->glGetString(GL_VERSION));
    if (!m_profile)
        return;
    // Desktop timer queries only. Unsupported contexts retain the wall/CPU
    // diagnostics; never emulate a GPU measurement by forcing completion.
    const auto format = context()->format();
    const bool gpuRequested = qEnvironmentVariable("T2GU_PROFILE_PRESENT_GPU").trimmed() != QLatin1String("0");
    const bool supported = gpuRequested && !context()->isOpenGLES()
        && (format.version() >= qMakePair(3, 3)
            || context()->hasExtension(QByteArrayLiteral("GL_ARB_timer_query")));
    bool created = supported;
    if (supported) {
        for (auto &query : m_queries) {
            query.timer = std::make_unique<QOpenGLTimerQuery>();
            if (!query.timer->create()) {
                created = false;
                break;
            }
        }
    }
    if (!created)
        releaseQueries();
    connect(context(), &QOpenGLContext::aboutToBeDestroyed, this, &OpenGLViewport::releaseQueries,
            Qt::DirectConnection);
    qInfo().nospace() << "[present] platform=" << QGuiApplication::platformName()
                     << "; desktop=" << qEnvironmentVariable("XDG_CURRENT_DESKTOP")
                     << "; Qt=" << qVersion() << "; scene-GPU-queries=" << created
                     << "; GPU-query-request=" << gpuRequested
                     << "; GPU-result-polling=" << m_pollResults
                     << "; prebind-without-GPU=" << m_bindBeforePaint
                     << "; cache-flush=" << qEnvironmentVariable("always_flush_cache")
                     << "; intel-disable-threaded-context-request="
                     << qEnvironmentVariable("intel_disable_threaded_context")
                     << "; GL swap-interval=" << format.swapInterval();
}

void OpenGLViewport::releaseQueries()
{
    const bool haveQueries = std::any_of(m_queries.begin(), m_queries.end(),
                                      [](const Query &q) { return bool(q.timer); });
    if (!haveQueries)
        return;
    // Query objects belong to this context, including on reparent/recreation.
    const bool alreadyCurrent = QOpenGLContext::currentContext() == context();
    if (!alreadyCurrent)
        makeCurrent();
    if (m_activeQuery >= 0)
        m_queries[m_activeQuery].timer->end();
    for (auto &query : m_queries)
        query = {};
    m_activeQuery = -1;
    if (!alreadyCurrent)
        doneCurrent();
}

void OpenGLViewport::append(Phase phase, qint64 wallNs, qint64 cpuDuration)
{
    auto &samples = m_samples[phase];
    if (wallNs < 0 || samples.wall.size() >= 1024)
        return;
    samples.wall.append(wallNs / 1.0e6);
    if (cpuDuration >= 0)
        samples.cpu.append(cpuDuration / 1.0e6);
}

bool OpenGLViewport::beginScenePaint(QGraphicsScene *scene)
{
    if (!m_profile || m_paintNs >= 0)
        return false;
    const auto runtimeGeneration = RuntimeMetrics::window().generation;
    if (m_scene != scene || m_runtimeGeneration != runtimeGeneration) {
        m_scene = scene;
        m_runtimeGeneration = runtimeGeneration;
        ++m_generation;
        m_samples = {};
        m_paintEndNs = m_paintEndCpuNs = m_composeNs = m_composeCpuNs = m_swapNs = -1;
        m_reportNs = RuntimeMetrics::monotonicNs();
        m_querySkips = 0;
        m_queryBegins = 0;
        m_contextBinds = 0;
        m_maxQueryLag = 0;
    }
    m_paintNs = RuntimeMetrics::monotonicNs();
    m_paintCpuNs = cpuNs();
    if (!isValid() || (!m_queries.front().timer && !m_bindBeforePaint))
        return true;

    // QGraphicsView paints via its viewport event filter, bypassing paintGL.
    // QPainter would bind this context itself; move that binding earlier
    // for query markers or the independent prebind comparison.
    if (QOpenGLContext::currentContext() != context()) {
        makeCurrent();
        ++m_contextBinds;
    }
    // Isolate early binding from query markers/polling in a diagnostic run.
    if (!m_queries.front().timer)
        return true;
    if (QOpenGLContext::currentContext() != context()) {
        ++m_querySkips;
        return true;
    }
    if (!m_pollResults) {
        // Beginning an ended query resets its result; OpenGL permits reuse
        // without reading it. Rotate through the fixed pool and discard the
        // old results, so this comparison issues markers but performs no
        // availability/result lookups or explicit completion waits.
        m_activeQuery = m_nextMarkerQuery;
        m_nextMarkerQuery = (m_nextMarkerQuery + 1) % int(m_queries.size());
        m_queries[m_activeQuery].timer->begin();
        ++m_queryBegins;
        return true;
    }
    for (int i = 0; i < int(m_queries.size()); ++i) {
        auto &query = m_queries[i];
        if (query.pending && query.timer->isResultAvailable()) {
            // Never fetch an unfinished result: no glFinish, explicit flush,
            // or query wait is introduced on the GUI thread.
            const auto elapsed = query.timer->waitForResult();
            if (query.generation == m_generation) {
                append(GpuScene, qint64(elapsed));
                m_maxQueryLag = std::max(m_maxQueryLag, m_frames - query.frame);
            }
            query.pending = false;
        }
    }
    for (int i = 0; i < int(m_queries.size()); ++i) {
        auto &query = m_queries[i];
        if (query.pending)
            continue;
        query.generation = m_generation;
        query.frame = m_frames;
        query.timer->begin();
        ++m_queryBegins;
        m_activeQuery = i;
        return true;
    }
    ++m_querySkips;
    return true;
}

void OpenGLViewport::endScenePaint()
{
    if (m_activeQuery >= 0) {
        if (QOpenGLContext::currentContext() != context())
            makeCurrent();
        auto &query = m_queries[m_activeQuery];
        query.timer->end();
        query.pending = m_pollResults;
        m_activeQuery = -1;
    }
    const qint64 now = RuntimeMetrics::monotonicNs();
    const qint64 cpu = cpuNs();
    append(ScenePaint, now - m_paintNs,
           cpu >= m_paintCpuNs && m_paintCpuNs >= 0 ? cpu - m_paintCpuNs : -1);
    m_paintEndNs = now;
    m_paintEndCpuNs = cpu;
    m_paintNs = -1;
}

void OpenGLViewport::aboutToComposeProfile()
{
    m_composeNs = RuntimeMetrics::monotonicNs();
    m_composeCpuNs = cpuNs();
    if (m_paintEndNs >= 0) {
        // Qt flushShared() precedes this signal. This gap also includes
        // raster chrome painting and any intervening event/scheduling delay.
        append(PaintToCompose, m_composeNs - m_paintEndNs,
               m_composeCpuNs >= m_paintEndCpuNs && m_paintEndCpuNs >= 0
                   ? m_composeCpuNs - m_paintEndCpuNs : -1);
        m_paintEndNs = -1; // chrome-only compositions don't reuse an old paint
    }
}

void OpenGLViewport::frameSwappedProfile()
{
    const qint64 now = RuntimeMetrics::monotonicNs();
    const qint64 cpu = cpuNs();
    if (m_composeNs >= 0) {
        append(ComposeToSwap, now - m_composeNs,
               cpu >= m_composeCpuNs && m_composeCpuNs >= 0 ? cpu - m_composeCpuNs : -1);
        m_composeNs = -1;
    }
    if (m_swapNs >= 0)
        append(SwapInterval, now - m_swapNs);
    m_swapNs = now;
    ++m_frames;
    report(now);
}

void OpenGLViewport::report(qint64 now)
{
    if (m_reportNs == 0) {
        m_reportNs = now;
        return;
    }
    if (now - m_reportNs < 3000000000LL)
        return;
    const QWindow *handle = window()->windowHandle();
    const QScreen *screen = handle ? handle->screen() : nullptr;
    const QSize pixels = size() * devicePixelRatioF();
    QStringList parts{
        QStringLiteral("[present] viewport=%1x%2 pixels=%3x%4 DPR=%5 screen=%6 Hz=%7; ms p50/p95/max")
            .arg(width()).arg(height()).arg(pixels.width()).arg(pixels.height())
            .arg(devicePixelRatioF()).arg(screen ? screen->name() : QStringLiteral("unknown"))
            .arg(screen ? screen->refreshRate() : 0)
    };
    constexpr std::array<const char *, PhaseCount> names{
        "scene-paint", "paint-to-compose", "compose-to-swap", "Qt-swap-interval", "scene-GPU"
    };
    for (int i = 0; i < PhaseCount; ++i) {
        const auto &samples = m_samples[i];
        parts.append(QStringLiteral("%1=%2 n=%3").arg(QLatin1String(names[i]))
                         .arg(RuntimeMetrics::distribution(samples.wall)).arg(samples.wall.size()));
        if (!samples.cpu.isEmpty())
            parts.append(QStringLiteral("%1 CPU=%2").arg(QLatin1String(names[i]))
                             .arg(RuntimeMetrics::distribution(samples.cpu)));
    }
    parts.append(QStringLiteral("GPU-query-skips=%1 max-result-lag=%2 swaps early-context-binds=%3 GPU-query-begins=%4")
                     .arg(m_querySkips).arg(m_maxQueryLag).arg(m_contextBinds).arg(m_queryBegins));
    qInfo().noquote() << parts.join(QStringLiteral("; "));
    m_samples = {};
    m_querySkips = 0;
    m_queryBegins = 0;
    m_contextBinds = 0;
    m_maxQueryLag = 0;
    m_reportNs = now;
}
#endif
