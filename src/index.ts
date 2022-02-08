import {
	commands,
	CompletionItem,
	CompletionItemKind,
	CompletionTriggerKind,
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
	workspace
} from 'coc.nvim'
import Handler from './handler'

var log: Logger

async function getService(id: string): Promise<IServiceProvider> {
	// @ts-expect-error
	await services.waitClient(id)
	return services.getService(id)
}

async function hackGo() {
	let service = await getService('go')
	let client = service.client! as LanguageClient
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
			if (!e.textEdit) {
				continue
			}
			log.info(e, e.textEdit.range)
			let { label, kind, filterText, textEdit } = e
			let { newText, range } = textEdit
			switch (kind) {
				case CompletionItemKind.Keyword:
					let start = range.start
					let end = range.end
					if (
						context.triggerKind != CompletionTriggerKind.TriggerCharacter &&
						start.line == end.line &&
						start.character == end.character
					) {
						log.warn(`${e.label} has filtered.`)
						continue
					} else if (
						label == filterText &&
						label.startsWith(document.getText(Range.create(start, position)))
					) {
						if (e.preselect) {
							e.preselect = false
						}
					}
					break
				case CompletionItemKind.Class:
					if (label == 'float32' || label == 'Float32') {
						float32Item = e
					}
					if (label == 'float64' || label == 'Float64') {
						float64Item = e
					}
				case CompletionItemKind.Snippet:
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
								textEdit.newText = newLhs.join(', ').concat(' := ', sects[1])
							}
							break
						case 'copy!':
						case 'keys!':
							let m = newText.match(/([^ :]+)(?: := make)/)
							if (m) {
								let copied = m[1]
								textEdit.newText = newText.replace(
									new RegExp(copied, 'g'),
									`$\{1:${copied}\}`
								)
							}
							break
						case 'range!':
							textEdit.newText = newText.replace(
								/(?<=^for )([^ ,]+), ([^ :]+)/,
								'${1:$1, }${2:$2}'
							)
							break
						default:
							break
					}
				default:
					break
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
}

async function hackClangd() {
	let filterKeys: string[] = ['if', 'else', 'else if', 'for', 'while', 'do']

	let service = await getService('clangd')
	let client = service.client! as LanguageClient
	let mw: Middleware = client.clientOptions.middleware!
	if (!mw) {
		return
	}
	let oldProvider = mw.provideCompletionItem
	mw.provideCompletionItem = async (document, position, context, token, next) => {
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
		return oldProvider
			? await oldProvider(
				document,
				position,
				context,
				token,
				(_document, _position, _context, _token) => list
			)
			: list
	}
}

export async function activate(context: ExtensionContext): Promise<void> {
	log = context.logger
	let { filetypes } = workspace
	let { subscriptions } = context

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

	const handler = new Handler(workspace.nvim, log)

	subscriptions.push(
		commands.registerCommand('kvs.symbol.docSymbols', async (bufnr, kinds) => {
			return await handler.symbols.getDocumentSymbols(bufnr, kinds)
		})
	)

	subscriptions.push(
		commands.registerCommand('kvs.fold.foldingRange', async (bufnr, kind) => {
			return await handler.fold.foldingRange(bufnr, kind)
		})
	)
}
