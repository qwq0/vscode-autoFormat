import * as vscode from "vscode";
import * as fs from "fs/promises";
import { ESLint, Linter } from "eslint";
import * as tsParse from "@typescript-eslint/parser";

let autoFormatEnable = false;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();


/**
 * @param {vscode.ExtensionContext} vscContext
 */
export async function activate(vscContext)
{
    const linter = new Linter({});
    const eslint = new ESLint({
        cwd: (vscode.workspace.workspaceFolders.length >= 1 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined),
        fix: true
    });

    // @ts-ignore
    linter.defineParser("@typescript-eslint/parser", tsParse);

    vscode.window.showInformationMessage("autoFormat on load");

    vscContext.subscriptions.push(
        // 虚拟文件系统
        vscode.workspace.registerFileSystemProvider(
            "autoformat",
            {
                onDidChangeFile: e =>
                {
                    return null;
                },
                watch: (uri, option) =>
                {
                    return new vscode.Disposable(() => { });
                },
                stat: async uri =>
                {
                    let path = uri.path[0] == "/" ? uri.path.slice(1) : uri.path;
                    let stat = await fs.stat(path);
                    return {
                        type: vscode.FileType.File,
                        ctime: stat.ctimeMs,
                        mtime: stat.mtimeMs,
                        size: 1,
                    };
                },
                readDirectory: uri =>
                {
                    return [];
                },
                createDirectory: uri => { },
                readFile: async uri =>
                {
                    let path = uri.path[0] == "/" ? uri.path.slice(1) : uri.path;
                    let srcText = await fs.readFile(path, {
                        encoding: "utf-8",
                    });

                    let fixReport = linter.verifyAndFix(srcText, {
                        env: {
                            es2022: true,
                            node: true
                        },
                        extends: "standard-with-typescript",
                        parserOptions: {
                            ecmaVersion: 'latest',
                            sourceType: 'module'
                        },
                        plugins: [
                            "@typescript-eslint"
                        ],
                        parser: "@typescript-eslint/parser",
                        rules: {
                            indent: ["error", 4],
                            semi: ["error", "always"],
                            quotes: ["error", "double"],
                            "brace-style": ["error", "allman"]
                        }
                    }, path.slice(path.lastIndexOf("/") + 1));
                    if (fixReport.messages.length != 0)
                        vscode.window.showErrorMessage(fixReport.messages.map(o => `${o.message}\n${o.line}:${o.column}\n`).join("\n"));
                    return textEncoder.encode(fixReport.output);
                },
                writeFile: async (uri, content, options) =>
                {
                    let path = uri.path[0] == "/" ? uri.path.slice(1) : uri.path;
                    let contentText = textDecoder.decode(content);

                    let fixReportArray = await eslint.lintText(contentText, {
                        filePath: path,
                        warnIgnored: true
                    });
                    if (fixReportArray.length != 1)
                    {
                        throw vscode.FileSystemError.NoPermissions("fixReportArray.length != 1");
                    }
                    let fixReport = fixReportArray[0];
                    if (fixReport.messages.length != 0)
                    {
                        vscode.window.showErrorMessage(fixReport.messages.map(o => `${o.message}\n${o.line}:${o.column}\n`).join("\n"));
                        throw vscode.FileSystemError.NoPermissions("Unresolved issues");
                    }
                    await fs.writeFile(path, fixReport.output, { encoding: "utf-8" });
                },
                delete: (uri, option) => { },
                rename: (oldUri, newUri, options) => { },
                copy: (source, destination, options) => { },
            },
            {
                isCaseSensitive: true,
                isReadonly: false,
            }
        )
    );


    {
        let intervalId = null;
        vscContext.subscriptions.push(
            // 切换总开关命令
            vscode.commands.registerCommand("autoFormat.switchEnable", () =>
            {
                autoFormatEnable = !autoFormatEnable;
                button.text = "autoFormat:" + (autoFormatEnable ? "on" : "off");
                if (autoFormatEnable)
                {
                    intervalId = setInterval(async () => // 检测打开文件
                    {
                        let uri = vscode.window.activeTextEditor.document.uri;
                        let suffix = uri.path.slice(uri.path.lastIndexOf(".") + 1);
                        if (uri.scheme == "file" && (suffix == "ts" || suffix == "js"))
                        {
                            let nowPath = vscode.window.activeTextEditor.document.uri.fsPath;
                            if (nowPath)
                            {
                                vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                                let path = nowPath.replaceAll("\\", "/");
                                let uri = vscode.Uri.parse(`autoformat://autoformat/${path}`);
                                let doc = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(doc, { preview: false });
                            }
                        }
                    }, 550);
                }
                else
                {
                    clearInterval(intervalId);
                }
            })
        );
        // 切换总开关状态栏按钮
        let button = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            0
        );
        button.text = "autoFormat:off";
        button.command = "autoFormat.switchEnable";
        vscContext.subscriptions.push(button);
        button.show();
    }

    {
        vscContext.subscriptions.push(
            // 打开文件命令
            vscode.commands.registerCommand("autoFormat.openFile", async () =>
            {
                let activeEditorUri = vscode.window.activeTextEditor.document.uri;
                if (activeEditorUri.scheme == "autoformat")
                {
                    button.text = "Already in the auto format editor";
                    setTimeout(() =>
                    {
                        button.text = "autoFormatEdit";
                    }, 2000);
                    return;
                }
                if (activeEditorUri.fsPath)
                {
                    let path = activeEditorUri.fsPath.replaceAll("\\", "/");
                    let uri = vscode.Uri.parse(`autoformat://autoformat/${path}`);
                    let doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
            })
        );

        // 打开文件按钮
        let button = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            0
        );
        button.text = "autoFormatEdit";
        button.command = "autoFormat.openFile";
        vscContext.subscriptions.push(button);
        button.show();
    }
}
