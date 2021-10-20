import {
	CompletionItem,
	CompletionItemKind,
	DiagnosticSeverity,
	DiagnosticTag,
	executable,
	ExtensionContext,
	IServiceProvider,
	LanguageClient,
	Logger,
	Middleware,
	Range,
	services,
	workspace,
} from 'coc.nvim'

var log: Logger

async function tryHack(serviceName: string, cb: (client: LanguageClient) => void) {
	let i = 10
	let timer = setInterval(() => {
		let service: IServiceProvider = services.getService(serviceName)
		if (service) {
			clearInterval(timer)
			cb(service.client!)
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

			let float32Item: CompletionItem, float64Item: CompletionItem
			let items = Array.isArray(list) ? list : list.items
			let newItems: CompletionItem[] = []
			for (const e of items) {
				let { label, kind, filterText } = e
				if (e.textEdit) {
					let { textEdit } = e
					log.warn(textEdit, label, kind, filterText)
					let { newText, range } = textEdit
					let start = range.start
					let end = range.end
					if (
						context.triggerKind != 2 &&
						start.line == end.line &&
						start.character == end.character
					) {
						continue
					}
					if (
						kind == CompletionItemKind.Keyword &&
						label == filterText &&
						label == document.getText(Range.create(start, position))
					) {
						continue
					}
					if (label == 'float32' || label == 'Float32') {
						float32Item = e
					}
					if (label == 'float64' || label == 'Float64') {
						float64Item = e
					}

					switch (label) {
						case 'var!':
							let sects = newText.split(' := ', 2)
							let newLhs: string[] = []
							if (sects.length == 2) {
								const lhs = sects[0].split(', ')
								for (let i = 0; i < lhs.length; i++) {
									const e = lhs[i]
									newLhs.push(`\${${i + 1}:${e}}`)
								}
								e.textEdit.newText = newLhs.join(', ').concat(' := ', sects[1])
							}
							break
						case 'copy!':
						case 'keys!':
							let m = newText.match(/([^ :]+)(?: := make)/)
							if (m) {
								let copied = m[1]
								e.textEdit.newText = newText.replace(new RegExp(copied, 'g'), `$\{1:${copied}\}`)
							}
							break
						case 'range!':
							e.textEdit.newText = newText.replace(
								/(?<=^for )([^ ,]+), ([^ :]+)/,
								'${1:$1, }${2:$2}'
							)
							break
						default:
							break
					}
				}

				let ch = label.charAt(0)
				if (ch == ch.toUpperCase()) {
					// @ts-expect-error
					e.score = 2.2
				}
				newItems.push(e)
			}

			if (float32Item! && float64Item! && float32Item.preselect) {
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

				let items = Array.isArray(list) ? list : list.items
				let newItems: CompletionItem[] = []
				for (const e of items) {
					let { filterText } = e
					if (filterKeys.includes(filterText!)) {
						continue
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
