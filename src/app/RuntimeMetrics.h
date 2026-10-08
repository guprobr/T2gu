#pragma once

#include <QDebug>
#include <QElapsedTimer>
#include <QFile>
#include <QStringList>
#include <QVector>
#include <algorithm>
#include <array>
#include <cmath>
#include <chrono>
#ifdef Q_OS_LINUX
#include <sys/resource.h>
#include <time.h>
#endif

// Wall time on the GUI thread, including synchronous callbacks and nested
// event processing. Nested categories explain their parent; do not sum them.
namespace RuntimeMetrics {
enum Category {
    VisualTimers, ScriptTick, EnemyAI, PartyAI, Combat, Pickups, Characters, Ui,
    Collision, Audio, ScriptExecution, Assets, SceneDispatch, WindowUpdate, ScenePaint,
    WidgetPaint, CategoryCount
};
inline constexpr std::array<const char *, CategoryCount> labels{
    "visual-timers", "script-tick", "enemy-ai", "party-ai", "combat-cleanup",
    "pickups", "characters", "ui-input-camera", "collision", "audio",
    "script-execution", "assets", "scene-dispatch", "window-update", "viewport-paint",
    "raster-widget-paint"
};

inline bool enabled()
{
    static const bool value = qEnvironmentVariableIntValue("T2GU_PROFILE_RUNTIME") == 1;
    return value;
}

struct Cost {
    qint64 total = 0;
    qint64 maximum = 0;
    int calls = 0;
#ifdef Q_OS_LINUX
    qint64 cpuTotal = 0;
    qint64 cpuMaximum = 0;
    int cpuCalls = 0;
#endif
};
struct Window {
    QElapsedTimer clock;
    quint64 generation = 0;
    std::array<Cost, CategoryCount> costs{};
    QVector<double> ticks, intervals, outside;
    qint64 previousStart = -1;
    qint64 previousEnd = -1;
    int clamped = 0;
    double discardedMs = 0;
    int slowEvents = 0;
    qint64 slowestEvent = 0;
    QString eventDescription;
    QString population;
#ifdef Q_OS_LINUX
    rusage resources{};
    QVector<double> tickCpu;
#endif
};
inline Window &window()
{
    static thread_local Window value;
    return value;
}

inline qint64 monotonicNs()
{
    return std::chrono::duration_cast<std::chrono::nanoseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}
#ifdef Q_OS_LINUX
inline qint64 threadCpuNs()
{
    timespec time{};
    if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time) != 0)
        return -1;
    return qint64(time.tv_sec) * 1000000000LL + time.tv_nsec;
}
#endif

inline void reset()
{
    if (!enabled())
        return;
    auto &w = window();
    const quint64 generation = w.generation + 1;
    w = {};
    w.generation = generation;
    w.clock.start();
#ifdef Q_OS_LINUX
    getrusage(RUSAGE_SELF, &window().resources);
#endif
}

class Sample
{
public:
    explicit Sample(Category category) : m_category(category)
    {
        if (enabled()) {
            m_generation = window().generation;
            m_clock.start();
#ifdef Q_OS_LINUX
            // Only these broad callbacks need a second clock. Avoid a CPU
            // clock syscall on every movement collision or character sample.
            if (m_category >= SceneDispatch)
                m_cpuStarted = threadCpuNs();
#endif
        }
    }
    ~Sample()
    {
        if (!enabled() || window().generation != m_generation)
            return;
        auto &cost = window().costs[m_category];
        const qint64 ns = m_clock.nsecsElapsed();
        cost.total += ns;
        cost.maximum = std::max(cost.maximum, ns);
        ++cost.calls;
#ifdef Q_OS_LINUX
        if (m_cpuStarted >= 0) {
            const qint64 cpuFinished = threadCpuNs();
            if (cpuFinished >= m_cpuStarted) {
                const qint64 cpuNs = cpuFinished - m_cpuStarted;
                cost.cpuTotal += cpuNs;
                cost.cpuMaximum = std::max(cost.cpuMaximum, cpuNs);
                ++cost.cpuCalls;
            }
        }
#endif
    }
private:
    Category m_category;
    QElapsedTimer m_clock;
    quint64 m_generation = 0;
#ifdef Q_OS_LINUX
    qint64 m_cpuStarted = -1;
#endif
};

inline QString distribution(QVector<double> samples)
{
    if (samples.isEmpty())
        return QStringLiteral("n/a");
    std::sort(samples.begin(), samples.end());
    const auto percentile = [&samples](double fraction) {
        return samples.at(std::max<qsizetype>(0, qsizetype(std::ceil(samples.size() * fraction)) - 1));
    };
    return QStringLiteral("%1/%2/%3").arg(percentile(0.5), 0, 'f', 3)
        .arg(percentile(0.95), 0, 'f', 3).arg(samples.last(), 0, 'f', 3);
}

inline void report()
{
    auto &w = window();
    if (w.clock.elapsed() < 3000 && w.ticks.size() < 1024)
        return;
    QStringList parts{
        QStringLiteral("[runtime] %1; ticks=%2; wall-ms p50/p95/max: tick=%3 interval=%4 outside-tick=%5")
            .arg(w.population).arg(w.ticks.size()).arg(distribution(w.ticks))
            .arg(distribution(w.intervals)).arg(distribution(w.outside)),
        QStringLiteral("dt-clamps=%1 discarded-ms=%2").arg(w.clamped).arg(w.discardedMs, 0, 'f', 1)
    };
    for (int i = 0; i < CategoryCount; ++i) {
        const auto &cost = w.costs[i];
        if (cost.calls)
            parts.append(QStringLiteral("%1 total/max-ms=%2/%3 calls=%4")
                .arg(QLatin1String(labels[i])).arg(cost.total / 1.0e6, 0, 'f', 3)
                .arg(cost.maximum / 1.0e6, 0, 'f', 3).arg(cost.calls));
#ifdef Q_OS_LINUX
        if (cost.cpuCalls)
            parts.append(QStringLiteral("%1 CPU-total/max-ms=%2/%3 calls=%4")
                .arg(QLatin1String(labels[i])).arg(cost.cpuTotal / 1.0e6, 0, 'f', 3)
                .arg(cost.cpuMaximum / 1.0e6, 0, 'f', 3).arg(cost.cpuCalls));
#endif
    }
    parts.append(QStringLiteral("Qt-events>=16ms=%1 worst=%2ms %3")
        .arg(w.slowEvents).arg(w.slowestEvent / 1.0e6, 0, 'f', 3).arg(w.eventDescription));
#ifdef Q_OS_LINUX
    parts.append(QStringLiteral("GUI-tick CPU-ms p50/p95/max=%1").arg(distribution(w.tickCpu)));
    rusage current{};
    if (getrusage(RUSAGE_SELF, &current) == 0) {
        parts.append(QStringLiteral("process minor/major-faults=%1/%2 voluntary/involuntary-switches=%3/%4")
            .arg(current.ru_minflt - w.resources.ru_minflt).arg(current.ru_majflt - w.resources.ru_majflt)
            .arg(current.ru_nvcsw - w.resources.ru_nvcsw).arg(current.ru_nivcsw - w.resources.ru_nivcsw));
    }
    QFile status(QStringLiteral("/proc/self/status"));
    if (status.open(QIODevice::ReadOnly)) {
        const auto lines = status.readAll().split('\n');
        for (const auto &line : lines) {
            if (line.startsWith("VmRSS:") || line.startsWith("VmSwap:"))
                parts.append(QString::fromLatin1(line.simplified()));
        }
    }
#endif
    qInfo().noquote() << parts.join(QStringLiteral("; "));
    // Preserve the interval across reports, but not across explicit pauses
    // and loading. The following tick includes this report's logging cost.
    const qint64 previousStart = w.previousStart;
    const qint64 previousEnd = w.previousEnd;
    const QString population = w.population;
    const quint64 generation = w.generation;
    reset();
    w.generation = generation;
    w.previousStart = previousStart;
    w.previousEnd = previousEnd;
    w.population = population;
}

class Tick
{
public:
    Tick(qreal rawDtSeconds, qreal simulatedDtSeconds, int party, int enemies, int npcs, int props, int items)
    {
        if (!enabled())
            return;
        auto &w = window();
        if (!w.clock.isValid())
            reset();
        m_generation = w.generation;
        m_clock.start();
        const qint64 started = monotonicNs();
        // Neither interval uses the clamped game delta.
        if (w.previousStart >= 0)
            w.intervals.append((started - w.previousStart) / 1.0e6);
        if (w.previousEnd >= 0)
            w.outside.append((started - w.previousEnd) / 1.0e6);
        w.previousStart = started;
#ifdef Q_OS_LINUX
        m_threadStarted = threadCpuNs();
#endif
        if (rawDtSeconds > simulatedDtSeconds) {
            ++w.clamped;
            w.discardedMs += (rawDtSeconds - simulatedDtSeconds) * 1000;
        }
        w.population = QStringLiteral("party/enemies/npcs/props/items=%1/%2/%3/%4/%5")
            .arg(party).arg(enemies).arg(npcs).arg(props).arg(items);
    }
    ~Tick()
    {
        if (!enabled() || window().generation != m_generation)
            return;
        auto &w = window();
        w.ticks.append(m_clock.nsecsElapsed() / 1.0e6);
        w.previousEnd = monotonicNs();
#ifdef Q_OS_LINUX
        const qint64 threadFinished = threadCpuNs();
        if (m_threadStarted >= 0 && threadFinished >= m_threadStarted)
            w.tickCpu.append((threadFinished - m_threadStarted) / 1.0e6);
#endif
        report();
    }
private:
    QElapsedTimer m_clock;
    quint64 m_generation = 0;
#ifdef Q_OS_LINUX
    qint64 m_threadStarted = -1;
#endif
};
}
