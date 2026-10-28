import React, { Component, ErrorInfo, ReactNode, createRef } from "react";
import { Button, buttonClasses } from "../ui/Button";
import {
    LANGUAGE_STORAGE_KEY,
    boundaryKind,
    boundaryLanguage,
    buildId,
    chunkReloadStarted,
    chunkReloadTried,
    isChunkLoadError,
    pageOfflineReload,
    sessionStorageOrNull,
} from "./chunkReload";
import { offlinePageBody, offlinePageTitle } from "./offlineReloadCopy";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

// Renders outside LanguageProvider and ThemeProvider (App.tsx), so no hooks: the language comes
// from storage and the colours from the token defaults.
// Phase 8 (S1): a route chunk that failed offline (or while the page waits for the connection)
// shows the offline controller's state instead of "a new version": offline and checking have no
// button (a reload or the home link would land on the browser's offline page or race the probe);
// unreachable (the browser is online, the app is silent) offers 「再読み込み」. This screen has
// nothing usable on it, so it holds requireReload(): the page reloads by itself once the app answers.
const copy = {
    en: {
        staleTitle: "A new version is available",
        staleBody: "Rise Path was updated while this tab was open. Reload the page to continue.",
        errorTitle: "Something went wrong",
        errorBody: "This page could not be shown. Reload it, or go back to the home screen.",
        reload: "Reload page",
        home: "Go to home",
        details: "Error details (development only)",
    },
    jp: {
        staleTitle: "新しいバージョンがあります",
        staleBody: "このタブを開いている間に Rise Path が更新されました。ページを再読み込みして続けてください。",
        errorTitle: "問題が発生しました",
        errorBody: "このページを表示できませんでした。再読み込みするか、ホームに戻ってください。",
        reload: "再読み込み",
        home: "ホームへ",
        details: "エラーの詳細（開発環境のみ）",
    },
};

function savedLanguage(): string | null {
    try {
        return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
        return null;
    }
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    private headingRef = createRef<HTMLHeadingElement>();
    private unsubscribe: (() => void) | null = null;
    private releaseReload: (() => void) | null = null;

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public componentDidMount() {
        // The waiting screen follows the controller (offline → checking → unreachable). The page may
        // start waiting after this screen came up (a chunk failed online first, then another one
        // failed offline): hold requireReload from then on, or the screen would promise a reload
        // that never comes.
        this.unsubscribe =
            pageOfflineReload()?.subscribe(() => {
                if (!this.state.hasError) return;
                this.holdReloadWhileWaiting();
                this.forceUpdate();
            }) ?? null;
    }

    public componentDidUpdate(_prevProps: Props, prevState: State) {
        if (!this.state.hasError || prevState.hasError) return;
        // The app it replaced may have held focus; start screen readers and keyboards here.
        this.headingRef.current?.focus();
        this.holdReloadWhileWaiting();
    }

    /** A failed chunk while the page waits: nothing usable here, so reload by itself once the app answers. */
    private holdReloadWhileWaiting() {
        const controller = pageOfflineReload();
        if (!controller || this.releaseReload || !isChunkLoadError(this.state.error) || controller.state() === "none") return;
        // Taken before the call: in 'back', requireReload checks again and notifies the subscription
        // above synchronously, which must not take a second hold.
        const hold = { release: () => {} };
        this.releaseReload = () => hold.release();
        hold.release = controller.requireReload();
    }

    public componentWillUnmount() {
        this.releaseReload?.();
        this.releaseReload = null;
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    public render() {
        if (this.state.hasError) {
            const { error } = this.state;
            const language = boundaryLanguage(savedLanguage(), document.documentElement.lang);
            const t = copy[language];
            const kind = boundaryKind(error, {
                wait: pageOfflineReload()?.state() ?? "none",
                reloadStarted: chunkReloadStarted(),
                reloadTried: chunkReloadTried(sessionStorageOrNull(), buildId(document)),
            });
            const waiting = kind === "offline" || kind === "checking" || kind === "unreachable";
            const stale = kind === "stale";
            const title = waiting ? offlinePageTitle(language, kind) : stale ? t.staleTitle : t.errorTitle;
            const body = waiting ? offlinePageBody(language, kind) : stale ? t.staleBody : t.errorBody;
            return (
                <main
                    lang={language === "jp" ? "ja" : "en"}
                    className="grid min-h-screen grid-cols-1 place-items-center bg-canvas px-4 py-10 text-fg"
                >
                    <div className="w-full max-w-form rounded-card border border-line bg-surface p-6 shadow-1">
                        <h1 ref={this.headingRef} tabIndex={-1} className="text-h2 text-fg focus:outline-none">
                            {title}
                        </h1>
                        {/* While waiting, a later state (checking, unreachable) is announced; the heading has focus. */}
                        <p role={waiting ? "status" : undefined} className="mt-2 text-body text-fg-2">{body}</p>
                        {kind === "unreachable" ? (
                            <div className="mt-5 flex flex-wrap gap-2">
                                <Button onClick={() => pageOfflineReload()?.reloadNow()}>{t.reload}</Button>
                            </div>
                        ) : waiting ? null : (
                            <div className="mt-5 flex flex-wrap gap-2">
                                <Button onClick={() => window.location.reload()}>{t.reload}</Button>
                                <a href={import.meta.env.BASE_URL} className={buttonClasses({ variant: "secondary" })}>
                                    {t.home}
                                </a>
                            </div>
                        )}
                        {import.meta.env.DEV && error ? (
                            <details className="mt-5 rounded-control border border-line bg-sunken p-3">
                                <summary className="cursor-pointer text-small font-semibold text-fg-2">{t.details}</summary>
                                <p className="mt-2 break-words font-mono text-small text-danger">{error.message}</p>
                                <pre className="mt-2 overflow-auto whitespace-pre font-mono text-caption text-fg-3">{error.stack}</pre>
                            </details>
                        ) : null}
                    </div>
                </main>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
