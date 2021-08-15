import {
	services,
	workspace,
	ExtensionContext,
	IServiceProvider,
	DiagnosticSeverity,
	DiagnosticTag,
	Logger,
	LanguageClient,
} from 'coc.nvim'
import { executable } from 'coc.nvim'

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
	let filterKeys: Array<string> = ['if', 'else', 'else if', 'for', 'while']
	tryHack('clangd', (client) => {
		client.clientOptions.middleware = {
			provideCompletionItem: (document, position, context, token, next) => {
				return next(document, position, context, token)!.then((result) => {
					result.items = result.items.filter((e) => {
						return !filterKeys.includes(e.filterText)
					})
					return result
				})
			},
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
