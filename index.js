var fs = require("fs");
var path = require("path");
var ramlParser = require('raml-1-parser');
var program = require('commander');
var _ = require('lodash');
var jsonfile = require('jsonfile');

// Define help
program
    .option('-f, --file <path>', 'RAML input file')
    .option('-o, --output <path>', 'output dir')
    .parse(process.argv);

// Show help if no file
if (!program.file) {
    console.log('No input file specified');
    program.outputHelp();
    process.exit(1);
}

// Proceed with file
var outputDir = path.resolve(process.cwd(), __dirname, program.output || 'out');
var ramlFile = checkIfFileExists(program.file);
var ramlApi = parseRamlFile(ramlFile);
var typeDefinitions = parseTypeDefinitions(ramlApi.types());
var jsonDefinitions = {};
var nestedDefinitions = [];

// Create output directory
if (!checkIfFileExists(outputDir)) {
    fs.mkdirSync(outputDir);
}

parseRamlToSingleJson(typeDefinitions);

//----------------------------------------------------------------------------------------------------
/**
 * Check if input file exists
 * @param filePath
 * @returns {string}
 */
function checkIfFileExists(filePath) {
    var inputFile = path.resolve(process.cwd(), filePath);

    try {
        fs.statSync(inputFile);
        return inputFile;
    }
    catch (e) {
        return false;
    }
}

/**
 * Convert Raml to API Object
 * @param ramlFile
 */
function parseRamlFile(ramlFile) {
    try {
        return ramlParser
            .loadApiSync(ramlFile)
            .expand();
    }
    catch (e) {
        console.log('Incorrect RAML file!');
        process.exit(1);
    }
}

function parseTypeDefinitions(typeDefinitions) {
    var parsedTypeDefinitions = {};

    typeDefinitions.forEach(function (typeDefinition, idx) {
        var name = typeDefinition.name();
        parsedTypeDefinitions[name] = typeDefinition.toJSON({serializeMetadata: false})[name]
    });

    return parsedTypeDefinitions;
}

function parseRamlToSingleJson(typeDefinitions) {
    _.forEach(typeDefinitions, function (definition, name) {
        if (!jsonDefinitions[name]) {
            jsonDefinitions[name] = recursivelyIterateProperties(definition);
        }
    });

    _.forEach(jsonDefinitions, function (definition, name) {
        if (nestedDefinitions.indexOf(name) === -1) {
            definition['$schema'] = "http://json-schema.org/draft-04/schema#";
            saveJsonFile(outputDir + '/' + name + '.json', definition);
        }
    });
}

function recursivelyIterateProperties(typeObject) {
    var jsonObject = _.cloneDeep(typeObject);

    if (_.isArray(_.result(jsonObject,'type'))) {
        jsonObject.type = jsonObject.type[0];

        //TODO: Arrays and nested user defined data types
        if (jsonObject.type.indexOf('[]') >= 0) {
            jsonObject.items = {
                type: jsonObject.type.replace('[]', '')
            };
            jsonObject.type = 'array';
        }

        // Unions
        if (jsonObject.type.indexOf('|') >= 0) {
            // Remove spaces
            jsonObject.type = jsonObject.type.replace(/ /g, '');
            // Split different types into array of types
            jsonObject.type = jsonObject.type.split('|');
        }
        // TODO: Parse array unions like (string | Person)[]
    }

    // Remove unnecessary keys
    // TODO: better to say which keys do we need
    jsonObject.name = undefined;
    jsonObject.displayName = undefined;
    jsonObject.repeat = undefined;
    jsonObject.structuredExample = undefined;

    if (jsonObject.type === 'object' && _.isObject(jsonObject.properties)) {
        // Find all required properties
        jsonObject.required = _.map(_.filter(jsonObject.properties, 'required'), 'name');

        // Parse children properties
        _.forEach(jsonObject.properties, function (propObject, propKey) {
            jsonObject.properties[propKey] = recursivelyIterateProperties(propObject);
        });
    } else {
        var type;

        if (Object.keys(typeDefinitions).indexOf(jsonObject.type) >= 0) {
            type = jsonObject.type;
            jsonObject = recursivelyIterateProperties(typeDefinitions[type]);
            jsonDefinitions[type] = jsonObject;
            nestedDefinitions.push(type);
        }
        else if (jsonObject.items && Object.keys(typeDefinitions).indexOf(jsonObject.items.type) >= 0) {
            type = jsonObject.items.type;
            jsonObject.items = recursivelyIterateProperties(typeDefinitions[type]);
            jsonDefinitions[type] = jsonObject.items;
            nestedDefinitions.push(type);
        }
    }

    return jsonObject;
}

function saveJsonFile(filePath, content) {
    console.log('Saving file ', filePath);
    return jsonfile.writeFileSync(filePath, content, {spaces: 2})
}

