#pragma once

#include <QElapsedTimer>
#include <array>

// Elapsed wall time in paint/submission calls, including possible driver
// waits; deliberately adds no GPU synchronization or GPU timer queries.
// Disabled by default so ordinary play does not time every scene item.
namespace PaintMetrics {
enum Category { Tiles, Props, OverflowShadows, Characters, Lighting, CategoryCount };

struct Frame {
    std::array<qint64, CategoryCount> nanoseconds{};
    std::array<int, CategoryCount> calls{};
    int waterBuilds = 0;
};

inline bool enabled()
{
    static const bool value = qEnvironmentVariableIntValue("T2GU_PROFILE_RENDER") == 1;
    return value;
}

inline Frame &currentFrame()
{
    static thread_local Frame frame;
    return frame;
}

class Sample
{
public:
    explicit Sample(Category category) : m_category(category)
    {
        if (enabled())
            m_clock.start();
    }
    ~Sample()
    {
        if (enabled()) {
            Frame &frame = currentFrame();
            frame.nanoseconds[m_category] += m_clock.nsecsElapsed();
            ++frame.calls[m_category];
        }
    }

private:
    Category m_category;
    QElapsedTimer m_clock;
};
}
