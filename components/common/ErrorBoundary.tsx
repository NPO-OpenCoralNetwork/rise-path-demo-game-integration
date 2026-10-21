import React, { Component, ErrorInfo, ReactNode, createRef } from "react";
import { Button, buttonClasses } from "../ui/Button";
import { LANGUAGE_STORAGE_KEY, boundaryLanguage, chunkReloadStarted, isChunkLoadError } from "./chunkReload";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

// Renders outside LanguageProvider and ThemeProvider (App.tsx), so no hooks: the language comes
// from storage and the colours from the token defaults.
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

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public componentDidUpdate(_prevProps: Props, prevState: State) {
        // The app it replaced may have held focus; start screen readers and keyboards here.
        if (this.state.hasError && !prevState.hasError) this.headingRef.current?.focus();
    }

    public render() {
        if (this.state.hasError) {
            const { error } = this.state;
            const language = boundaryLanguage(savedLanguage(), document.documentElement.lang);
            const t = copy[language];
            const stale = isChunkLoadError(error) || chunkReloadStarted();
            return (
                <main
                    lang={language === "jp" ? "ja" : "en"}
                    className="grid min-h-screen grid-cols-1 place-items-center bg-canvas px-4 py-10 text-fg"
                >
                    <div className="w-full max-w-form rounded-card border border-line bg-surface p-6 shadow-1">
                        <h1 ref={this.headingRef} tabIndex={-1} className="text-h2 text-fg focus:outline-none">
                            {stale ? t.staleTitle : t.errorTitle}
                        </h1>
                        <p className="mt-2 text-body text-fg-2">{stale ? t.staleBody : t.errorBody}</p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <Button onClick={() => window.location.reload()}>{t.reload}</Button>
                            {stale ? null : (
                                <a href={import.meta.env.BASE_URL} className={buttonClasses({ variant: "secondary" })}>
                                    {t.home}
                                </a>
                            )}
                        </div>
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
