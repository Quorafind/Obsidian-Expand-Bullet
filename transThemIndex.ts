import { App, Editor, MarkdownView, Menu, normalizePath, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface TransThemSettings {
	removeFirstLine: boolean;
	keepOriginalText: boolean;
}

const DEFAULT_SETTINGS: TransThemSettings = {
	removeFirstLine: false,
	keepOriginalText: true,
}

export default class TransThemPlugin extends Plugin {
	settings: TransThemSettings;

	async onload() {
		this.addSettingTab(new TransThemSettingTab(this.app, this));
		await this.loadSettings();
		this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
			  const range = editor.getCursor();

			  const beginRange = {
				  ch: 0,
				  line: range.line,
			  }
			  // Check if the cursor is at the bullet point
			  const newRange = {
				  ch: range.ch + 1,
				  line: range.line,
			  }
			  const bulletString = editor.getRange(beginRange , newRange);
			  if(!(/^\s*[-\*\+]\s?$/.test(bulletString))) {
				  return;
			  }
			  menu.addItem((item) =>
                  item
                    .setIcon("hash")
                    .setTitle(`Transfer bullet to note`)
                    .onClick(async () => {
						await this.createNoteWithBulletContent(editor, this.settings.removeFirstLine);
                    })
                );
			}),
		  );
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onLayoutReady(): Promise<void> {
		this.addCommand({
			id: 'transform-bullet-into-note',
			name: 'Transform bullet into note with first line',
			editorCallback: (editor: Editor) => {
				this.createNoteWithBulletContent(editor, this.settings.removeFirstLine);
			},
		});
	}

	public async createNoteWithBulletContent(editor: Editor, removeFirstLine: boolean) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const view: EditorView = (editor as any).cm;
		const range = editor.getCursor();
		const currentLine = editor.getLine(range.line);
		if(!(/^\s*[-\*\+]\s+/.test(currentLine))) {
			return;
		}
		const lineRange = this.calculateRangeForTransform(view.state, editor.posToOffset(range));

		if(!lineRange) {
			return;
		}
		const tokenForTabAndSpace = this.shouldReplaceToken(currentLine);
		const text = editor.getRange(editor.offsetToPos(lineRange.from), editor.offsetToPos(lineRange.to));
		if(!this.settings.keepOriginalText) {
			// Temporary remove the bullet
			const titleText = currentLine.replace(/^(\s*[-\*\+]\s+)/,"");
			const linkText = titleText.replace(/(.*)?/, "[[$1]]");

			// Get the begin and end of the range
			const contentBeginPositions = editor.offsetToPos(lineRange.from);
			const contentEndPositions = editor.offsetToPos(lineRange.to);

			editor.replaceRange(currentLine.replace(titleText, linkText), contentBeginPositions, contentEndPositions);
		}
		const content = this.shouldInsertContent(text, tokenForTabAndSpace, removeFirstLine);

		// Original Code from https://github.com/obsidian-community/obsidian-community-lib/blob/d6196aac3c413ba6fe71106736f7c998891f6203/src/utils.ts#L189
		const newFileFolder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path).path;
		const newFilePath = normalizePath(
			`${newFileFolder}${newFileFolder === "/" ? "" : "/"}${this.addMD(currentLine?.replace(/^\s*([-*+]|\d+\.)\s+/g,""))}`
		);

		const createdFile = await app.vault.create(newFilePath, content);
		await app.workspace.getUnpinnedLeaf().openFile(createdFile);
	}

	public shouldInsertContent(text: string, token: string | null, removeFirstLine: boolean): string {
		let tempContent: string = "";
		const spiltContentByLineBreak = text.split(/\r?\n/);
		if(token) {
			for(let i = 0; i < spiltContentByLineBreak.length; i++) {
				if(!i) {
				 	if(!removeFirstLine) {
						tempContent = spiltContentByLineBreak[0].replace(token, '');
					}
					continue;
				}

				if(removeFirstLine) {
					tempContent += (i === 1 ? `${spiltContentByLineBreak[i].replace(token, '').replace(token[0], '')}` : `\n${spiltContentByLineBreak[i].replace(token, '').replace(token[0], '')}`);
				}else{
					tempContent += `\n${spiltContentByLineBreak[i].replace(token, '')}`;
				}
			}
			return tempContent;
		}else {
			if(!removeFirstLine) {
				return text;
			}

			// No Token But Remove first line
			let tempToken;
			if(spiltContentByLineBreak.length > 1) {
				tempToken = this.shouldReplaceToken(spiltContentByLineBreak[1]);
			}

			for(let i = 0; i < spiltContentByLineBreak.length; i++) {
				if(!i) {
				 	if(!removeFirstLine) {
						tempContent = spiltContentByLineBreak[0].replace(tempToken, '');
					}
					continue;
				}

				if(removeFirstLine) {
					tempContent += (i === 1 ? `${spiltContentByLineBreak[i].replace(tempToken, '').replace(tempToken[0] === ' '? '' : '\t', '')}` : `\n${spiltContentByLineBreak[i].replace(tempToken, '').replace(tempToken[0] === ' '? '' : '\t', '')}`);
				}else{
					tempContent += `\n${spiltContentByLineBreak[i].replace(tempToken, '')}`;
				}
			}
			return tempContent;
		}
	}

	public shouldReplaceToken(text: string): string {
		const beginWithTab = text.startsWith('\t');
		const beginWithSpace = text.startsWith(' ');
		if(!beginWithSpace && !beginWithTab) {
			return null;
		}
		const tabAndSpace = text.match(/^\s*/g)[0];
		return tabAndSpace;
	}

	private addMD = (noteName: string): string => {
		return noteName.match(/\.MD$|\.md$/m) ? noteName : noteName + ".md";
	};

	public calculateRangeForTransform(state: EditorState, pos: number) {
		const line = state.doc.lineAt(pos);
		const foldRange = foldable(state, line.from, line.to);

		if (!foldRange && /^\s*([-*+]|\d+\.)\s+/.test(line.text)) {
			return { from: line.from, to: line.to };
		}

		if (!foldRange) {
			return null;
		}

		return { from: line.from, to: foldRange.to };
	}
}

class TransThemSettingTab extends PluginSettingTab {
	plugin: TransThemPlugin;
	private applyDebounceTimer: number = 0;

	constructor(app: App, plugin: TransThemPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	applySettingsUpdate() {
		clearTimeout(this.applyDebounceTimer);
		const plugin = this.plugin;
		this.applyDebounceTimer = window.setTimeout(() => {
		  plugin.saveSettings();
		}, 100);
	  }

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Menu Them'});

		new Setting(containerEl)
			.setName('Remove First Line when Create Note')
			.setDesc('remove first bullet line when create new note')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.removeFirstLine).onChange(async (value) => {
					this.plugin.settings.removeFirstLine = value;
					this.applySettingsUpdate();
        		}));

		new Setting(containerEl)
			.setName('Keep Original Text')
			.setDesc('keep original text when create new note')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.keepOriginalText).onChange(async (value) => {
					this.plugin.settings.keepOriginalText = value;
					this.applySettingsUpdate();
				}));
	}
}
