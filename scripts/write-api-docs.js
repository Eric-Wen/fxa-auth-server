#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const acorn = require('acorn')
const P = require('../lib/promise')
const fs = P.promisifyAll(require('fs'), { suffix: 'P' })
const path = require('path')

const args = parseArgs()

const ACORN_OPTIONS = {
  locations: true,
  sourceType: 'script'
}
const IGNORE = new Set([ 'index.js', 'validators.js' ])
const ROUTES_DIR = path.resolve(__dirname, '../lib/routes')
const FUNCTION_EXPRESSION_TYPES = new Set([ 'FunctionExpression', 'ArrowFunctionExpression' ])
const ROUTE_DEFINITION_TYPES = new Set([ 'ArrayExpression' ])
const RETURN_TYPES = new Set([ 'ReturnStatement' ])

const docs = parseDocs(args.path)
parseRoutes()
  .then(routes => generateOutput(docs, routes))
  .then(output => writeOutput(output, args.path))

function parseArgs () {
  let outputPath

  switch (process.argv.length) {
    /* eslint-disable indent, no-fallthrough */
    case 3:
      outputPath = path.resolve(process.argv[2])
    case 2:
      break
    default:
      fail(`Usage: ${process.argv[1]} [outputPath]`)
    /* eslint-enable indent, no-fallthrough */
  }

  return {
    path: outputPath || path.resolve(__dirname, '../docs/api.md')
  }
}

function fail (message, filePath, lineNumber) {
  let debugFriendlyMessage
  if (filePath) {
    debugFriendlyMessage = `Error parsing "${filePath}"`
    if (lineNumber) {
      debugFriendlyMessage += ` at line ${lineNumber}`
    }
    debugFriendlyMessage += `:\n${message}`
  } else {
    debugFriendlyMessage = message
  }

  console.error(debugFriendlyMessage)
  process.exit(1)
}

function parseDocs (docsPath) {
}

function parseRoutes () {
  return fs.readdirP(path.resolve(__dirname, '../lib/routes'))
    .then(fileNames => {
      return Promise.all(
        fileNames
          .filter(fileName => fileName.endsWith('.js') && ! IGNORE.has(fileName))
          .map(fileName => path.join(ROUTES_DIR, fileName))
          .filter(filePath => fs.statSync(filePath).isFile())
          .map(filePath => {
            return fs.readFileP(filePath)
              .then(js => ({
                path: filePath,
                ast: acorn.parse(js, ACORN_OPTIONS)
              }))
          })
      )
    })
}

function generateOutput (docs, files) {
  return files.reduce((document, file) => {
    const filePath = file.path
    const ast = file.ast

    const exportedFunction = findExportedFunction(ast, filePath)
    const routes = findReturnedData(exportedFunction, filePath)
    routes.forEach(route => {
      document += JSON.stringify(route, null, '  ')
    })
    return document
  }, '')
}

function findExportedFunction (node, filePath) {
  const exported = find(node, {
    type: 'ExpressionStatement',
    expression: {
      type: 'AssignmentExpression',
      left: {
        type: 'MemberExpression',
        object: {
          type: 'Identifier',
          name: 'module'
        },
        property: {
          type: 'Identifier',
          name: 'exports'
        }
      }
    }
  }, {
    recursive: true
  })

  if (exported.length !== 1) {
    fail(`Expected 1 export, found ${exported.length}`, filePath)
  }

  const exportedFunction = exported[0].expression.right
  assertType(exportedFunction, FUNCTION_EXPRESSION_TYPES, filePath)

  return exportedFunction.body
}

function find (node, criteria, options) {
  options = options || {}

  if (match(node, criteria)) {
    return [ node ]
  }

  if (Array.isArray(node) && options.array) {
    return node.reduce((results, property) => {
      return results.concat(find(property, criteria, options))
    }, [])
  }

  if (isObject(node) && options.recursive) {
    return Object.keys(node).reduce((results, key) => {
      return results.concat(find(node[key], criteria, options))
    }, [])
  }

  return []
}

function match (node, criteria) {
  if (! isObject(node)) {
    if (node === criteria) {
      return true
    }

    return false
  }

  if (! isObject(criteria)) {
    return false
  }

  return Object.keys(criteria).every(criteriaKey => {
    return Object.keys(node).some(nodeKey => {
      return match(node[nodeKey], criteria[criteriaKey])
    })
  })
}

function isObject (node) {
  return node && typeof node === 'object'
}

function assertType (node, types, filePath) {
  if (! node) {
    fail(`Expected type [${Array.from(types).join(',')}], found nothing`, filePath)
  }

  const nodeType = node.type
  const line = node.loc.start.line
  const column = node.loc.start.column

  if (! types.has(nodeType)) {
    fail(`Expected type [${Array.from(types).join(',')}], found "${nodeType}" at column "${column}"`, filePath, line)
  }
}

function findReturnedData (functionNode, filePath) {
  let returnedData
  if (functionNode.type === 'BlockStatement') {
    const returned = find(functionNode.body, {
      type: 'ReturnStatement'
    }, {
      array: true
    })

    if (returned.length !== 1) {
      fail(`Expected 1 return statement, found ${returned.length}`, filePath)
    }

    returnedData = returned[0].argument
  } else {
    assertType(returnedData, RETURN_TYPES, filePath)
    returnedData = functionNode.argument
  }

  if (returnedData.type === 'Identifier') {
    const routeDefinitions = find(functionNode, {
      type: 'VariableDeclarator',
      id: {
        type: 'Identifier',
        name: returnedData.name
      }
    }, {
      recursive: true
    })

    if (routeDefinitions.length !== 1) {
      fail(`Expected 1 set of route definitions, found ${routeDefinitions.length}`, filePath)
    }

    returnedData = routeDefinitions[0].init
  }

  assertType(returnedData, ROUTE_DEFINITION_TYPES, filePath)

  return returnedData.elements
}

function writeOutput (output, outputPath) {
  fs.writeFileSync(outputPath, output, { mode: 0o644 })
}

