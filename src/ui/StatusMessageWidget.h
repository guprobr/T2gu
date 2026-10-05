#pragma once

#include <QElapsedTimer>
#include <QTimer>
#include <QVector>
#include <QWidget>

#include "game/GameScene.h"

// A small box centered at the top of the view listing recent game events
// (items gathered, enemies defeated, party members fallen, levels reached).
// Each line holds for a couple of seconds and then fades out on its own -
// longer than the "Level Up!" caption, since a line of text takes longer to
// read, but short enough that it never becomes a log. Like
// SelectionInfoWidget it never takes focus or pauses play, and it is
// transparent to the mouse so clicks still reach the scene underneath.
class StatusMessageWidget : public QWidget
{
    Q_OBJECT

public:
    explicit StatusMessageWidget(QWidget *parent = nullptr);

    void post(const QString &text, GameScene::StatusKind kind);
    // The box is centered horizontally in the parent at `top`, never wider
    // than `maxWidth` (MainWindow keeps it clear of the selection panel in
    // the top-left corner). Lines that don't fit are elided.
    void setLayoutBounds(int top, int maxWidth);

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    struct Line
    {
        QString text;
        GameScene::StatusKind kind;
        int repeats = 1;
        QElapsedTimer age;
    };

    void expireAndAnimate();
    void relayout();
    QString displayText(const Line &line) const;

    QVector<Line> m_lines;
    QTimer m_animTimer;
    int m_top = 8;
    int m_maxWidth = 480;
};
