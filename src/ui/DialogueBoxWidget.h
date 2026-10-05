#pragma once

#include <QWidget>

class QLabel;

// A simple bottom-anchored dialogue panel (speaker name + message text),
// shown/hidden by MainWindow in response to GameScene::dialogueRequested/
// dialogueEnded. Holds no game logic; MainWindow positions it (see
// MainWindow::resizeEvent) since only it knows the view's current size.
class DialogueBoxWidget : public QWidget
{
    Q_OBJECT

public:
    explicit DialogueBoxWidget(QWidget *parent = nullptr);

    void showMessage(const QString &speaker, const QString &text);

private:
    QLabel *m_speakerLabel;
    QLabel *m_textLabel;
};
