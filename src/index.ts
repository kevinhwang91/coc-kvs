import {
	CompletionItem,
	CompletionItemKind,
	DiagnosticSeverity,
	DiagnosticTag,
	executable,
	ExtensionContext,
	InsertTextFormat,
	IServiceProvider,
	LanguageClient,
	Logger,
	Middleware,
	Range,
	services,
	workspace,
} from 'coc.nvim'

var log: Logger

function tryHack(serviceName: string, cb: (client: LanguageClient) => void) {
	let i = 10
	let timer = setInterval(() => {
		let service: IServiceProvider = services.getService(serviceName)
		if (service) {
			cb(service.client!)
			clearInterval(timer)
		} else if (i <= 0) {
			clearInterval(timer)
		}
		i--
	}, 200)
}

function hackGo() {
	tryHack('go', (client) => {
		let mw: Middleware = client.clientOptions.middleware!
		if (!mw) {
			return
		}

		if (executable('kgo')) {
			mw.handleDiagnostics = (uri, diagnostics, next) => {
				for (const d of diagnostics) {
					let code = d.code
					if (code == 'UnusedVar' || code == 'UnusedImport') {
						d.tags = [DiagnosticTag.Unnecessary]
						d.severity = DiagnosticSeverity.Hint
					}
				}
				next(uri, diagnostics)
			}
		}
		mw.provideCompletionItem = async (document, position, context, token, next) => {
			let list = await next(document, position, context, token)
			if (!list) {
				return []
			}

			let float32Item: CompletionItem, float64Item: CompletionItem;
			let items = Array.isArray(list) ? list : list.items
			let newItems: CompletionItem[] = []
			for (const e of items) {
				// log.warn(e)
				let { textEdit, label, kind, filterText } = e
				if (textEdit) {
					let start = textEdit.range.start
					let prefix = document.getText(Range.create(start, position))
					if (kind == CompletionItemKind.Keyword && label == filterText && label == prefix) {
						continue
					}
					if (label == 'float32') {
						float32Item = e
					}
					if (label == 'float64') {
						float64Item = e
					}
				}
				newItems.push(e)
			}

			if (float32Item! && float64Item!) {
				float32Item.preselect = false
				float64Item.preselect = true
			}

			if (Array.isArray(list)) {
				list = newItems
			} else {
				list.items = newItems
			}
			return list
		}
	})
}

function hackClangd() {
	let filterKeys: string[] = ['if', 'else', 'else if', 'for', 'while', 'do']
	let tailRegex = /^\s*$/
	tryHack('clangd', (client) => {
		let mw: Middleware = client.clientOptions.middleware!
		if (!mw) {
			return
		}
		let oldProvider = mw.provideCompletionItem!
		mw.provideCompletionItem = (document, position, context, token, next) => {
			let kvProvider = async (document, position, context, token) => {
				let list = await next(document, position, context, token)
				if (!list) {
					return []
				}

				let tail = (await workspace.nvim.eval(`strpart(getline('.'), col('.') - 1)`)) as string

				let addSemicolon = tailRegex.test(tail)
				let items = Array.isArray(list) ? list : list.items
				let newItems: CompletionItem[] = []
				for (const e of items) {
					let { textEdit, insertTextFormat, filterText, kind } = e
					if (filterKeys.includes(filterText!)) {
						continue
					}
					if (addSemicolon && insertTextFormat == InsertTextFormat.Snippet) {
						if (textEdit) {
							let { newText } = textEdit
							if (kind == CompletionItemKind.Function) {
								e.textEdit = { range: textEdit.range, newText: newText + ';' }
							} else if (kind == CompletionItemKind.Text && newText.slice(-1) == ')') {
								// macro function
								e.textEdit = { range: textEdit.range, newText: newText + ';' }
							}
						}
					}
					newItems.push(e)
				}
				if (Array.isArray(list)) {
					list = newItems
				} else {
					list.items = newItems
				}
				return list
			}

			if (oldProvider) {
				return oldProvider(document, position, context, token, kvProvider)
			} else {
				return kvProvider(document, position, context, token)
			}
		}
	})
}

export async function activate(context: ExtensionContext): Promise<void> {
	log = context.logger
	let { filetypes } = workspace

	// TODO: should refactor :(
	let goType = ['go', 'gomod']
	let hit: boolean = false
	for (const ft of filetypes) {
		if (goType.includes(ft)) {
			hackGo()
			hit = true
			break
		}
	}
	if (!hit) {
		let disposable = workspace.onDidOpenTextDocument((doc) => {
			let { languageId } = doc
			if (goType.includes(languageId)) {
				disposable.dispose()
				hackGo()
			}
		})
	}

	let cType = ['c', 'cpp']
	hit = false
	for (const ft of filetypes) {
		if (cType.includes(ft)) {
			hackClangd()
			hit = true
			break
		}
	}
	if (!hit) {
		let disposable = workspace.onDidOpenTextDocument((doc) => {
			let { languageId } = doc
			if (cType.includes(languageId)) {
				disposable.dispose()
				hackClangd()
			}
		})
	}
}
