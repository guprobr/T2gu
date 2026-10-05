#pragma once

#include <QWidget>

class QLabel;

// A full-view black overlay shown briefly during a level transition (see
// MainWindow::loadLevel()) - big yellow "Loading" text, plus the target
// chapter's title (from its map JSON's "title" field, if it has one) on
// the line below. MainWindow keeps it visible through candidate population
// and restoration, and for a minimum duration so a warm transition remains
// readable. Cold sprite decoding may take substantially longer.
class LoadingOverlayWidget : public QWidget
{
    Q_OBJECT

public:
    explicit LoadingOverlayWidget(QWidget *parent = nullptr);

    // `chapterTitle` may be empty (a map with no "title" field, e.g. the
    // sandbox) - only the "Loading" line is shown in that case, not a
    // blank second line under it.
    void showLoading(const QString &chapterTitle);

private:
    QLabel *m_loadingLabel;
    QLabel *m_chapterLabel;
};
