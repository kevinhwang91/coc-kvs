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
		client.clientOptions.middleware = {
			handleDiagnostics: (uri, diagnostics, next) => {
				for (let diagnostic of diagnostics) {
					let code = diagnostic.code
					if (code == 'UnusedVar' || code == 'UnusedImport') {
						diagnostic.tags = [DiagnosticTag.Unnecessary]
						diagnostic.severity = DiagnosticSeverity.Hint
					}
				}
				next(uri, diagnostics)
			},
		}
	})
}

function hackClangd() {
	let filterKeys: string[] = ['if', 'else', 'else if', 'for', 'while']
	let tailRegex = /^\s*$/
	tryHack('clangd', (client) => {
		let mw: Middleware = client.clientOptions.middleware!
		if (!mw) {
			return
		}
		let oldProvider = mw.provideCompletionItem!
		mw!.provideCompletionItem = (document, position, context, token, next) => {
			let kvProvider = async (document, position, context, token) => {
				let list = await next(document, position, context, token)
				if (!list) {
					return []
				}

				let tail = (await workspace.nvim.eval(`strpart(getline('.'), col('.') - 1)`)) as string

				let addSemicolon = tailRegex.test(tail)
				let items = Array.isArray(list) ? list : list.items
				let newItems: CompletionItem[] = []
				for (let i = 0; i < items.length; i++) {
					const e = items[i]
					if (filterKeys.includes(e.filterText!)) {
						continue
					}
					if (addSemicolon && e.insertTextFormat == InsertTextFormat.Snippet) {
						let textEdit = e.textEdit!
						if (textEdit) {
							let kind = e.kind
							let newText = textEdit.newText
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
	if (executable('kgo')) {
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
	}

	let cType = ['c', 'cpp']
	let hit: boolean = false
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
