import assert from 'assert';
import { readFile } from 'fs/promises';
import modulePg from 'pg';
const { Client } = modulePg;

import { isEmpty, dirJoin } from './util.js';
import { Dbo } from '../dbo.js';

// eslint-disable-next-line
const refColsSql = await readFile(dirJoin(import.meta.url,'../sql/table-reference-columns.sql'),'utf8');

/**
 * Column object
 * @typedef {Object} column
 * @property {string} name - наименование
 * @property {string} datatype - тип данных
 * @property {string} datatype_length - размер типа данных
 * @property {string} datatype_full - полностью тип данных datatype(datatype_length)
 * @property {boolean} required - признак обязательности
 * @property {string} default_value - значение по-умолчанию
 * @property {string} comment - описание
 * @property {string} fk_tablename - имя таблицы со схемой, на которую ссылается колонка
 * @property {number} column_id - порядковый номер колонки в таблице
 * @property {string} identity - способ генерации следующего значения
 * @property {string} tableName - имя таблицы (со схемой)
 */

/**
 * Exclude column object
 * @typedef {Object} excludeColumn
 * @property {string} name - наименование колонки
 * @property {string} op - оператор
 */

/**
 * Constraint object
 * @typedef {Object} constraint
 * @property {string} name - наименование
 * @property {string} schema - схема бд
 * @property {string} type - тип, c - check,f - foreign, u - unique,p - primary,x - exclude
 * @property {string} update_rule - действия с дочерними записями при исправлении первичного ключа в родительской
 * @property {string} delete_rule - действия с дочерними записями при удалении родительской
 * @property {string} condition - проверяемое выражение для type = c
 * @property {string} definition - полный код ограничения
 * @property {string} columns - список колонок, участвуюих в ограничении
 * @property {string} r_schema - имя схемы таблицы, на которую указывает ограничение. Для type = f
 * @property {string} r_tablename - имя таблицы, на которую указывает ограничение. Для type = f
 * @property {string} r_columnname - имя колонки таблицы, на которую указывает ограничение. Для type = f
 * @property {string} comment - описание
 * @property {string} deferrable - признак возможности откладывания проверки ограничения (deferred|immediate|null)
 * @property {Array<excludeColumn>} ix_columns - колонки, участвующие в поддерживающем индексе
 * @property {string} ix_method - метод формирования поддерживащего индекса
 * @property {string} ix_where_expr - условие для поддерживающего индекса
 * @property {string} tableName - имя таблицы со схемой
 */

/**
 * Index object
 * @typedef {Object} index
 * @property {string} name - наименование
 * @property {string} schema - схема бд
 * @property {Array<indexColumn>} columns - колонки, входящие в индекс с параметрами
 * @property {boolean} is_unique - признак уникальности
 * @property {string} tablespace - табличное пространство
 * @property {string} definition - полный код определения индекса
 * @property {string} method - метод формирования
 * @property {string} where_expr - условие ограничения
 * @property {string} tableName - имя таблицы со схемой
 */

/**
 * @typedef {Object} partition
 * @property {string} key -- ключ секционирования состоящий из стратегии (List, Range, Hash)
 *      и столбцов и/или выражений:
 *          LIST (budget_cycle_id) или
 *          RANGE (col1, TRIM(BOTH FROM col2), COALESCE(col3, (0)::bigint))
 */

/**
 * Table object
 * @typedef TableDboType
 * @type {Object}
 * @property {string} tablename - наименование
 * @property {string} schema - схема бд
 * @property {partition} partition - схема партицирования
 * @property {string} comment - описание
 * @property {Array<column>} cols - колонки
 * @property {Array<constraint>} cons - ограничения
 * @property {Array<index>} indx - индекс
 * @alias CcccTable
 */

/**
 * Результат поиска уникальных ключей для таблиц по переданным описателям внешних ключей другой таблицы
 * @typedef {Object} RefColDboType
 * @property {string} columns - колонка таблицы - внешний ключ
 * @property {string} r_schema - схема таблицы, на которую ссылка
 * @property {string} r_tablename - имя таблицы
 * @property {string} r_columnname - поле - первичный ключ, на которое ссылается column
 * @property {Array<string>} unique_cols - список колонок - уникальный ключей таблицы, на которую ссылка
 */

/**
 *
 * @param {TableDboType} table
 * @param {string} columnsScript
 * @returns {string}
 */
function addTable(table, columnsScript = null) {
    let script = '';
    script += `create table ${table.schema}.${table.tablename} (${columnsScript ?? ''})`;
    if (table.partition){
        script += ` partition by ${table.partition.key}`;
    }
    script += ';';
    if (table.comment) {
        script += `comment on table ${table.schema}.${table.tablename} is '${table.comment}';`;
    }
    return script;
}

function updTable(tableNew, tableOld) {
    let script = '';
    if (tableOld && tableOld.tablename !== tableNew.tablename) {
        script += `alter table ${tableOld.schema}.${tableOld.tablename} rename to ${tableNew.tablename};`;
    }
    if (tableOld.comment !== tableNew.comment) {
        script += `comment on table ${tableNew.schema}.${tableNew.tablename} is '${tableNew.comment}';`;
    }
    return script;
}

/**
 * addColumn return type
 * @typedef {Object} addColumnReturn
 * @property {string} main основной скрипт создания колонки
 * @property {string} [setNotNull] скрипт выставления признака not null
 * @property {string} [comment] скрипт создания комментария
 */

/**
 * Генерация скрипта создания колонки таблицы
 * @param {column} column - колонка таблицы
 * @param {boolean} [createTableMode = false] - при создании таблицы нужно создавать колонки сразу, не через alter table add column
 * @returns addColumnReturn
 */
function addColumn(column, createTableMode = false) {
    const script = {};
    // eslint-disable-next-line max-len
    if (createTableMode) {
        script.main = `${column.name} ${column.datatype}${((column.datatype_length) ? `(${column.datatype_length})` : '')}`;
    } else {
        script.main = `alter table ${column.tableName} add column ${column.name} ${column.datatype}${((column.datatype_length) ? `(${column.datatype_length})` : '')}`;
    }
    if (column.default_value) script.main += ` default ${column.default_value}`;
    if (column.required) script.setNotNull = `alter table ${column.tableName} alter column ${column.name} set not null;`;
    if ('identity' in column && !isEmpty(column.identity)) {
        const _identity = (column.identity === 'a') ? 'always' : 'by default';
        script.main += ` generated ${_identity} as identity`;
    }
    if (!createTableMode) script.main += ';';
    if (column.comment) {
        script.comment = `comment on column ${column.tableName}.${column.name} is '${column.comment}';`;
    }
    return script;
}

/**
 * updColumn return type
 * @typedef {Object} updColumnReturn
 * @property {string} [rename] скрипт смены наименования колонки
 * @property {string} [datatype] скрипт смены типа данных колонки
 * @property {string} [default] снятие\установка значения по-умолчанию
 * @property {string} [identity] снятие\установка способа генерации значений в колонке
 * @property {string} [setNotNull]  установка признака not null
 * @property {string} [dropNotNull]  снятие признака not null
 * @property {string} [comment] скрипт создания комментария
 */

/**
 * Генерация скрипта изменения колонки таблицы
 * @param {column} columnNew - колонка с изменениями
 * @param {column} columnOld - изначальная колонка

 * @returns updColumnReturn
 */
function updColumn(columnNew, columnOld) {
    const table = columnNew.tableName;
    const script = {};
    if (columnOld.name !== columnNew.name) {
        script.rename = `alter table ${table} rename column ${columnOld.name} to ${columnNew.name};`;
    }
    if (columnOld.datatype !== columnNew.datatype || (columnOld.datatype_length ?? null) !== (columnNew.datatype_length ?? null)) {
        script.datatype = `alter table ${table} alter column ${columnNew.name} type ${columnNew.datatype}${((columnNew.datatype_length) ? `(${columnNew.datatype_length})` : '')};`;
    }
    if ((columnOld.default_value ?? null) !== (columnNew.default_value ?? null)) {
        if (columnNew.default_value) {
            script.default = `alter table ${table} alter column ${columnNew.name} set default ${columnNew.default_value}::${columnNew.datatype};`;
        } else {
            script.default = `alter table ${table} alter column ${columnNew.name} drop default;`;
        }
    }
    if (columnOld.required !== columnNew.required) {
        if (columnNew.required) {
            script.setNotNull = `alter table ${table} alter column ${columnNew.name} set not null;`;
        } else {
            script.dropNotNull = `alter table ${table} alter column ${columnNew.name} drop not null;`;
        }
    }
    if ('identity' in columnOld && 'identity' in columnNew && (columnOld.identity ?? null) !== (columnNew.identity ?? null)) {
        if (isEmpty(columnNew.identity)) {
            script.identity += `alter table ${table} alter column ${columnNew.name} drop identity if exists;`;
        } else {
            const _identity = (columnNew.identity === 'a') ? 'always' : 'by default';
            if (isEmpty(columnOld.identity)) {
                script.identity = `alter table ${table} alter column ${columnNew.name} add generated ${_identity} as identity;`;
            } else {
                script.identity = `alter table ${table} alter column ${columnNew.name} set generated ${_identity};`;
            }
        }
    }
    if ((columnOld.comment ?? null) !== (columnNew.comment ?? null)) {
        script.comment = `comment on column ${table}.${columnNew.name} is '${columnNew.comment}';`;
    }
    return script;
}

/**
 * Генерация скрипта удаления колонки таблицы
 * @param {column} column - колонка
 * @returns {string}
 */
function delColumn(column) {
    return `alter table ${column.tableName} drop column if exists ${column.name};`;
}

/**
 * Построение выражения ограничения
 * @param {constraint} constraint - ограничение
 * @returns {string}
 */
function constraintExpr(constraint) {
    const acts = {
        r: 'restrict',
        c: 'cascade',
        n: 'set null',
        d: 'set default',
    };
    let expr;
    switch (constraint.type) {
        case 'c':
            expr = `check (${constraint.condition})`;
            break;
        case 'p':
            expr = `primary key (${constraint.columns})`;
            break;
        case 'u':
            expr = `unique (${constraint.columns})`;
            break;
        case 'f':
            expr = `foreign key (${constraint.columns}) references ${constraint.r_schema}.${constraint.r_tablename}(${constraint.r_columnname})`;
            expr += (constraint.update_rule === 'a' || isEmpty(constraint.update_rule)) ? '' : ` on update ${acts[constraint.update_rule]}`;
            expr += (constraint.delete_rule === 'a' || isEmpty(constraint.update_rule)) ? '' : ` on delete ${acts[constraint.delete_rule]}`;
            break;
        case 'x':
            expr = `exclude using ${constraint.ix_method} (${constraint.ix_columns.map(ic => `${ic.name} with ${ic.op}`).join(',')})`;
            expr += (constraint.ix_where_expr) ? ` where (${constraint.ix_where_expr})` : '';
            break;
        default:
            break;
    }
    expr += (constraint.deferrable) ? ` deferrable initially ${constraint.deferrable}` : '';
    return expr;
}

/**
 * Генерация скрипта создания ограничения таблицы
 * @param {constraint} constraint - ограничение
 * @param {boolean} [simple] - способ генерации (true - по готовому коду definition, иначе полное построение)
 * @returns {string}
 */
function addConstraint(constraint, simple = false) {
    let script = `alter table ${constraint.tableName} add constraint ${constraint.name} ${simple ? constraint.definition : constraintExpr(constraint)};`;
    if (constraint.comment) script += `comment on constraint ${constraint.name} on ${constraint.tableName} is '${constraint.comment}'`;
    return script;
}

/**
 * Генерация скрипта удаления ограничения таблицы
 * @param {constraint} constraint - ограничение
 * @returns {string}
 */
function delConstraint(constraint) {
    return `alter table ${constraint.tableName} drop constraint if exists ${constraint.name};`;
}

/**
 * Генерация скрипта изменения ограничения таблицы
 * @param {constraint} constraintNew - ограничение
 * @param {constraint} constraintOld - предыдущая версия ограничения
 * @param {boolean} [simple] - способ генерации (true - по готовому коду definition, иначе полное построение)
 * @returns {string}
 */
function updConstraint(constraintNew, constraintOld, simple = false) {
    const table = constraintNew.tableName;
    if (constraintNew.type === constraintOld.type && constraintNew.type === 'p' && constraintNew.name !== constraintOld.name) {
        return `alter table ${table} rename constraint ${constraintOld.name} to ${constraintNew.name};`;
    }
    return delConstraint(constraintOld) + addConstraint(constraintNew, simple);
}

/**
 * Index column object
 * @typedef {Object} indexColumn
 * @property {string} name - наименование колонки
 * @property {string} collate - правило сортировки для строковых типов
 * @property {string} order - порядок следования значений (asc|desc)
 * @property {string} nulls - место расположения в индексе значений null колонки (first|last)
 */

/**
 * Генерация скрипта создания индекса таблицы
 * @param {index} indx - индекс
 * @param {boolean} [simple] - способ генерации (true - по готовому коду definition, иначе полное построение)
 * @returns {string}
 */
function addIndex(indx, simple = false) {
    let script;
    if (simple) {
        script = `${indx.definition};`;
    } else {
        script = `create ${(indx.is_unique) ? 'unique ' : ''}index ${indx.name} on ${indx.tableName}`;
        const cols = indx.columns
            .map((col) => {
                let colScript = `${col.name}${(col.collate) ? ` ${col.collate}` : ''}`;
                if (col.order) colScript += ` ${col.order}`;
                if (col.nulls) colScript += ` nulls ${col.nulls}`;
                return colScript;
            })
            .join(',');
        script += ` using ${indx.method || 'btree'} (${cols})`;
        if (indx.where_expr) script += ` where (${indx.where_expr})`;
        script += ';';
    }
    return script;
}

/**
 * Генерация скрипта удаления индекса таблицы
 * @param {index} indx - индекс
 * @returns {string}
 */
function delIndex(indx) {
    return `drop index if exists ${indx.schema}.${indx.name};`;
}

/**
 * Генерация скрипта исправления индекса таблицы
 * @param {index} indxNew - новое состояние индекса
 * @param {index} indxOld - изначальное состояние
 * @param {boolean} [simple] - способ генерации (true - по готовому коду definition, иначе полное построение)
 * @returns {string}
 */
function updIndex(indxNew, indxOld, simple = false) {
    return delIndex(indxOld) + addIndex(indxNew, simple);
}

/**
 * Diff result object
 * @typedef {Object} DiffResultDboType
 * @property {Array<string>} main - основные изменения
 * @property {Array<string>} end - изменения на самый конец
 * @property {Array<string>} pkey - первичные и уникальные ключи
 * @property {Array<string>} safedrop - безопасные удаления
 * @property {Array<string>} unsafedrop - удаления колонок
 */

class DboTable extends Dbo {
    /**
     * Сравнение и получение скрипта изменения от одной версии объекта к другой
     * @param {TableDboType} newObj
     * @param {TableDboType} oldObj
     * @param {Object} options - дополнительные параметры сравнения
     * @param {boolean} [options.simple] - упрощенное сравнение
     * @param {function} [options.checkObjName] - кастомная функция выяснения, что делать с более не присутствующими индексами и ограничениями
     * @returns {DiffResultDboType}
     */
    static diff(newObj, oldObj, options= {}) {
        const { simple = true, checkObjName = undefined } = options;
        if (!oldObj) {
            oldObj = {
                schema: null,
                tablename: null,
                cols: [],
                indx: [],
                cons: []
            };
        }
        newObj.tableName = `${newObj.schema}.${newObj.tablename}`;
        oldObj.tableName = `${oldObj.schema}.${oldObj.tablename}`;
        function getNames(arr, nameKey) {
            return (arr) ? arr.map(item => item[nameKey]) : [];
        }

        function getByName(arr, nameKey, name) {
            return arr.find(item => item[nameKey] === name);
        }

        function arrStrOps(arr1, arr2, cmd) {
            let resArr = [];
            if (cmd === 'except') resArr = arr1.filter(item1 => arr2.indexOf(item1) === -1);
            if (cmd === 'intersect') resArr = arr1.filter(item1 => arr2.indexOf(item1) !== -1);
            return resArr;
        }

        function isEqual(obj1, obj2) {
            try {
                assert.deepStrictEqual(obj1, obj2);
                return true;
            } catch (e) {
                return false;
            }
        }

        const res = { main: [], safedrop: [], unsafedrop: [], end: [], pkey: [] };
        function log(script, part = 'main') {
            if (!(part in res)) res[part] = [];
            if (script && script !== '') res[part].push(script);
        }

        [...(newObj.cols || []), ...(newObj.cons || []), ...(newObj.indx || [])].forEach((c) => { c.tableName = newObj.tableName; });
        [...(oldObj.cols || []), ...(oldObj.cons || []), ...(oldObj.indx || [])].forEach((c) => { c.tableName = oldObj.tableName; });
        // колонки
        const cols = getNames(newObj.cols, 'name');
        const colsOld = getNames(oldObj.cols, 'name');
        let columnsToAdd = arrStrOps(cols, colsOld, 'except');

        // таблица создаётся
        if (!oldObj.tablename) {
            //сначала генерируем скрипт для колонок
            let columnsScript = { main: [], end: []};
            columnsToAdd.forEach((colName) => {
                const col = getByName(newObj.cols, 'name', colName);
                const s = addColumn(col, true);

                columnsScript.main.push(s.main);
                if (s.setNotNull) columnsScript.end.push(s.setNotNull);
                if (s.comment) columnsScript.end.push(s.comment);
            });

            log(addTable(newObj, columnsScript.main.join(', ')));
            for (const cScript of columnsScript.end){
                log(cScript, 'end');
            }

            columnsToAdd = [];
        } else { // изменяется
            log(updTable(newObj, oldObj));
        }

        // новые колонки
        columnsToAdd.forEach((colName) => {
            const col = getByName(newObj.cols, 'name', colName);
            const s = addColumn(col);
            log(s.main);
            if (s.setNotNull) log(s.setNotNull, 'end');
            if (s.comment) log(s.comment, 'end');
        });
        // более несуществующие колонки
        arrStrOps(colsOld, cols, 'except').forEach((colName) => {
            const col = getByName(oldObj.cols, 'name', colName);
            log(delColumn(col), 'unsafedrop');
        });
        // обновление колонок
        arrStrOps(cols, colsOld, 'intersect').forEach((colName) => {
            const col = getByName(newObj.cols, 'name', colName);
            const colOld = getByName(oldObj.cols, 'name', colName);
            // есть изменения
            if (!isEqual(col, colOld)) {
                const s = updColumn(col, colOld);
                if (s.rename) log(s.rename);
                if (s.datatype) {
                    log(s.datatype);
                    log(colName, 'colChangeDatatype');
                }
                if (s.default) log(s.default);
                if (s.identity) log(s.identity);
                if (s.dropNotNull) log(s.dropNotNull);
                if (s.setNotNull) log(s.setNotNull, 'end');
                if (s.comment) log(s.comment, 'end');
            }
        });
        // ограничения
        const cons = getNames(newObj.cons, 'name');
        const consOld = getNames(oldObj.cons, 'name');
        // новые ограничения
        arrStrOps(cons, consOld, 'except').forEach((conName) => {
            const con = getByName(newObj.cons, 'name', conName);
            const scr = addConstraint(con, simple);
            const { type } = con;
            // первичный ключ и уникальные ключи отделяем от внешних ключей,
            // чтобы отвязаться от построения зависимостей при создании внешних ключей в конце
            if (type === 'p' || type === 'u') {
                log(scr, 'pkey');
            } else {
                log(scr, 'end');
            }
        });
        // более не существующие ограничения, созданные базовой поставкой
        arrStrOps(consOld, cons, 'except').forEach((conName) => {
            if ((checkObjName && checkObjName(conName, oldObj.tablename)) || !checkObjName) {
                const con = getByName(oldObj.cons, 'name', conName);
                log(delConstraint(con), 'safedrop');
            }
        });
        // обновление ограничений
        arrStrOps(cons, consOld, 'intersect').forEach((conName) => {
            const con = getByName(newObj.cons, 'name', conName);
            const conOld = getByName(oldObj.cons, 'name', conName);
            if (simple) {
                delete con.condition;
                delete conOld.condition;
            }
            // есть изменения
            if (!isEqual(con, conOld)) {
                log(delConstraint(conOld), 'safedrop');
                const scr = addConstraint(con, simple);
                const { type } = con;
                if (type === 'p' || type === 'u') {
                    log(scr, 'pkey');
                } else {
                    log(scr, 'end');
                }
            }
        });
        // индексы
        const indx = getNames(newObj.indx, 'name');
        const indxOld = getNames(oldObj.indx, 'name');
        // новые индексы
        arrStrOps(indx, indxOld, 'except').forEach((indxName) => {
            const ind = getByName(newObj.indx, 'name', indxName);
            const scr = addIndex(ind, simple);
            const { is_unique } = ind;
            if (is_unique) {
                log(scr, 'pkey');
            } else {
                log(scr, 'end');
            }
        });
        // более несуществующие индексы, созданные базовой поставкой
        arrStrOps(indxOld, indx, 'except').forEach((indxName) => {
            if ((checkObjName && checkObjName(indxName, oldObj.tablename)) || !checkObjName) {
                const ind = getByName(oldObj.indx, 'name', indxName);
                log(delIndex(ind), 'safedrop');
            }
        });
        // обновление индексов
        arrStrOps(indx, indxOld, 'intersect').forEach((indName) => {
            const ind = getByName(newObj.indx, 'name', indName);
            const indOld = getByName(oldObj.indx, 'name', indName);
            // есть изменения
            if (!isEqual(ind, indOld)) {
                log(delIndex(indOld), 'safedrop');
                const scr = addIndex(ind, simple);
                const { is_unique } = ind;
                if (is_unique) {
                    log(scr, 'pkey');
                } else {
                    log(scr, 'end');
                }
            }
        });
        return res;
    }

    /**
     * Объединение детального результата изменения таблицы в один скрипт
     * @param {DiffResultDboType} diffRes - результат сравнения таблицы с предыдущим состоянием
     * @returns {string}
     */
    static diffToScript(diffRes) {
        return [
            ...(diffRes.safedrop ?? []),
            ...(diffRes.unsafedrop ?? []),
            ...(diffRes.main ?? []),
            ...(diffRes.pkey ?? []),
            ...(diffRes.end ?? [])
        ].join('\r\n');
    }

    /**
     * Поиск полей таблиц, которые можно использовать как вывод человеко-читаемых данных по переданным внешним ключам таблицы
     * @param {Client} connect - соединение с базой данных
     * @param {Array<constraint>} refCons - внешние ключи таблицы
     * @returns {Promise<Array<RefColDboType>>}
     */
    static async getRefColsByCons(connect, refCons) {
        const query = {
            text: refColsSql,
            values: [refCons]
        }
        const resQuery = await connect.query(query);
        return resQuery.rows;
    }
}

DboTable._getSql = await readFile(dirJoin(import.meta.url,'../sql/table-get.sql'),'utf8');

export {
    DboTable,
    addColumn,
    updColumn,
    delColumn,
    addConstraint,
    updConstraint,
    delConstraint,
    addIndex,
    updIndex,
    delIndex
};
