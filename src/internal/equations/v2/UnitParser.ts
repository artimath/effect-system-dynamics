import type { IToken } from "chevrotain"
import {
  Caret,
  LParen,
  Minus,
  UnitPer,
  RParen,
  Slash,
  Star,
  UnitIdentifier,
  UnitLexer,
  UnitNumber,
  WhiteSpace,
} from "./tokens.js"
import { divideUnits, multiplyUnits, powUnits, type UnitMap } from "../Quantity.js"
import { EquationDiagnosticError, type EquationDiagnostic } from "./Diagnostic.js"

interface UnitTokenStream {
  readonly peek: (offset?: number) => IToken | undefined
  readonly consume: () => IToken
  readonly match: (tokenType: unknown) => boolean
  readonly expect: (tokenType: unknown, message: string, code?: EquationDiagnostic["code"]) => IToken
  readonly done: () => boolean
}

class Stream implements UnitTokenStream {
  readonly #tokens: ReadonlyArray<IToken>
  readonly #baseOffset: number
  readonly #source: string
  #index = 0

  constructor(tokens: ReadonlyArray<IToken>, text: string, baseOffset: number) {
    this.#tokens = tokens
    this.#baseOffset = baseOffset
    this.#source = text
  }

  peek(offset = 0): IToken | undefined {
    return this.#tokens[this.#index + offset]
  }

  consume(): IToken {
    const token = this.peek()
    if (!token) {
      throw this.error(undefined, "Unexpected end of unit expression")
    }
    this.#index += 1
    return token
  }

  match(tokenType: unknown): boolean {
    const token = this.peek()
    if (token && token.tokenType === tokenType) {
      this.#index += 1
      return true
    }
    return false
  }

  expect(tokenType: unknown, message: string, code: EquationDiagnostic["code"] = "InvalidUnitToken"): IToken {
    const token = this.peek()
    if (!token || token.tokenType !== tokenType) {
      throw this.error(token, message, code)
    }
    this.#index += 1
    return token
  }

  done(): boolean {
    return this.#index >= this.#tokens.length
  }

  error(token: IToken | undefined, message: string, code: EquationDiagnostic["code"] = "InvalidUnitToken"): EquationDiagnosticError {
    return new EquationDiagnosticError({
      diagnostic: createUnitDiagnostic(this.#source, this.#baseOffset, token, code, message),
    })
  }
}

const createUnitDiagnostic = (
  text: string,
  baseOffset: number,
  token: IToken | undefined,
  code: EquationDiagnostic["code"],
  message: string,
): EquationDiagnostic => {
  const span = token
    ? {
        start: baseOffset + (token.startOffset ?? 0),
        end: baseOffset + (token.endOffset ?? token.startOffset ?? 0) + 1,
        line: 1,
        column: (token.startColumn ?? 1),
      }
    : undefined
  const base: Omit<EquationDiagnostic, "span" | "snippet"> = {
    phase: "parse",
    code,
    message,
  }
  return span
    ? {
        ...base,
        span,
        snippet: unitSnippet(text, token),
      }
    : base as EquationDiagnostic
}

const unitSnippet = (text: string, token: IToken | undefined): string => {
  if (!token) {
    return text
  }
  const caretPosition = Math.max(0, (token.startColumn ?? 1) - 1)
  return `${text}\n${" ".repeat(caretPosition)}^`
}

const isSquared = (token: IToken): boolean => token.image?.toLowerCase() === "squared"
const isCubed = (token: IToken): boolean => token.image?.toLowerCase() === "cubed"

const parseProduct = (stream: Stream): UnitMap => {
  let current = parseTerm(stream)
  while (true) {
    if (stream.match(Star)) {
      current = multiplyUnits(current, parseTerm(stream))
      continue
    }
    if (stream.match(Slash) || stream.match(UnitPer)) {
      current = divideUnits(current, parseTerm(stream))
      continue
    }
    break
  }
  return current
}

const parseTerm = (stream: Stream): UnitMap => {
  let base = parseAtom(stream)
  if (stream.match(Caret)) {
    const negative = stream.match(Minus)
    const exponentToken = stream.expect(UnitNumber, "Expected exponent after '^'", "InvalidUnitExponent")
    const exponent = Number(exponentToken.image) * (negative ? -1 : 1)
    if (!Number.isFinite(exponent)) {
      throw stream.error(exponentToken, "Invalid unit exponent", "InvalidUnitExponent")
    }
    base = powUnits(base, exponent)
  }
  const maybePow = stream.peek()
  if (maybePow && maybePow.tokenType === UnitIdentifier) {
    if (isSquared(maybePow)) {
      stream.consume()
      base = powUnits(base, 2)
    } else if (isCubed(maybePow)) {
      stream.consume()
      base = powUnits(base, 3)
    }
  }
  return base
}

const parseAtom = (stream: Stream): UnitMap => {
  if (stream.match(LParen)) {
    const inner = parseProduct(stream)
    stream.expect(RParen, "Expected ')' in unit literal")
    return inner
  }
  const token = stream.expect(UnitIdentifier, "Expected unit identifier")
  const parts = [token.image]
  while (true) {
    const next = stream.peek()
    if (!next || next.tokenType !== UnitIdentifier || isSquared(next) || isCubed(next)) {
      break
    }
    parts.push(stream.consume().image)
  }
  const name = parts.join(" ").trim()
  const unit: UnitMap = Object.create(null)
  unit[name] = 1
  return unit
}

export const parseUnitExpression = (text: string, baseOffset: number): UnitMap => {
  const lexing = UnitLexer.tokenize(text)
  if (lexing.errors.length > 0) {
    const { message } = lexing.errors[0]!
    throw new EquationDiagnosticError({
      diagnostic: {
        phase: "parse",
        code: "InvalidUnitToken",
        message,
      },
    })
  }
  const tokens = lexing.tokens.filter((token) => token.tokenType !== WhiteSpace)
  if (tokens.length === 0) {
    return Object.create(null)
  }
  const stream = new Stream(tokens, text, baseOffset)
  const result = parseProduct(stream)
  if (!stream.done()) {
    throw stream.error(stream.peek(), "Unexpected trailing input in unit literal", "InvalidUnitToken")
  }
  return result
}
