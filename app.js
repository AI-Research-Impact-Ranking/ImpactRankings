// Each tab is one ranking, read from two CSV files in data/:
//   rankingFile  one row per institution: name, country, continent, then one score column per
//                conference/year group (e.g. ACL_2021); an empty cell is zero
//   peopleFile   one row per (person, institution) with the same group columns
// An institution's score under any conference/year selection is the sum of the selected group
// columns, so the conference and year filters re-rank exactly instead of approximating.
const TABS = {
    universities: {
        rankingFile: 'data/university_ranking.csv',
        peopleFile: 'data/university_faculty.csv',
        entityCol: 'University',
        personCol: 'Faculty Name',
        statLabel: 'Universities',
        statIcon: 'fa-university',
        columnLabel: 'Institution',
        peopleLabel: 'Faculty Members',
        personLabel: 'Faculty Name',
        emptyPeople: 'No faculty data available for the selected fields.',
        exportName: 'ai-rankings',
        searchPlaceholder: 'Search universities or faculty',
        papersFile: null
    },
    companies: {
        rankingFile: 'data/company_ranking.csv',
        peopleFile: 'data/company_authors.csv',
        entityCol: 'Company',
        personCol: 'Author',
        statLabel: 'Companies',
        statIcon: 'fa-building',
        columnLabel: 'Company',
        peopleLabel: 'Authors',
        personLabel: 'Author',
        emptyPeople: 'No author data available for the selected fields.',
        exportName: 'ai-company-rankings',
        searchPlaceholder: 'Search companies or authors',
        papersFile: 'data/company_papers.json'   // {company: [{title, year, cites: {group: n}}]}
    }
};
const DEFAULT_TAB = 'universities';

const EPS = 1e-9;
// Every field is rescaled so its scores sum to this across the institutions of a tab, which
// keeps a field with many conference/year groups from outweighing the others.
const FIELD_TARGET_TOTAL = 500;
const TOP_PAPERS = 10;
const PEOPLE_PAGE = 100;

let conferences = [];          // [{id, name, field}] from data/conferences.csv
let fields = [];               // field names, in display order
let datasets = {};             // tab -> Promise of its loaded dataset
let data = null;               // dataset of the tab on screen
let currentTab = DEFAULT_TAB;
let selectedConferences = new Set();
let expandedFields = new Set();
let yearFrom = null;           // null = no lower / upper bound
let yearTo = null;
let selectedRegion = 'all';
let selectedCountry = 'all';
let searchQuery = '';          // normalized text of the search box
let lastRanked = [];           // every row the filters keep, ranked
let lastFiltered = [];         // the rows on screen: lastRanked narrowed by the search
let expandedRows = new Set();
let descriptionExpanded = false;

function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch !== '"') {
                cell += ch;
            } else if (text[i + 1] === '"') {
                cell += '"';
                i++;
            } else {
                quoted = false;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            row.push(cell);
            cell = '';
        } else if (ch === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else if (ch !== '\r') {
            cell += ch;
        }
    }
    if (cell !== '' || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

async function loadCSV(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error(`${filePath}: ${response.status}`);
    const rows = parseCSV(await response.text());
    const headers = rows.shift().map(h => h.trim());
    return { headers, rows };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

async function initialize() {
    setupTabs();
    setupFieldFilter();
    setupYearFilter();
    setupRegionFilter();
    setupCountryFilter();
    setupSearch();
    setupTableEvents();

    try {
        const table = await loadCSV('data/conferences.csv');
        const col = name => table.headers.indexOf(name);
        conferences = table.rows.map(r => ({
            id: r[col('Conference')],
            name: r[col('Name')] || r[col('Conference')],
            field: r[col('Category')]
        }));
        fields = Array.from(new Set(conferences.map(c => c.field)));
        selectedConferences = new Set(conferences.map(c => c.id));
    } catch (error) {
        showLoadError(error);
        return;
    }
    switchTab(tabFromHash());
}

function tabFromHash() {
    const name = window.location.hash.replace('#', '');
    return TABS[name] ? name : DEFAULT_TAB;
}

function setupTabs() {
    document.querySelectorAll('.ranking-tab').forEach(button => {
        button.addEventListener('click', () => {
            if (button.dataset.tab === currentTab && data) return;
            history.replaceState(null, '', button.dataset.tab === DEFAULT_TAB
                ? window.location.pathname : '#' + button.dataset.tab);
            switchTab(button.dataset.tab);
        });
    });
    window.addEventListener('hashchange', () => {
        if (tabFromHash() !== currentTab) switchTab(tabFromHash());
    });
}

async function switchTab(tab) {
    const config = TABS[tab];
    currentTab = tab;
    data = null;
    lastRanked = [];
    lastFiltered = [];
    expandedRows.clear();
    selectedRegion = 'all';
    selectedCountry = 'all';
    document.getElementById('regionFilter').value = 'all';
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchInput').placeholder = config.searchPlaceholder;

    document.querySelectorAll('.ranking-tab').forEach(button => {
        const active = button.dataset.tab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.getElementById('entityStatLabel').textContent = config.statLabel;
    document.getElementById('entityStatIcon').className = 'fas ' + config.statIcon;
    document.getElementById('institutionHeader').textContent = config.columnLabel;
    updateDescription();

    document.querySelector('#rankingTable tbody').innerHTML = '';
    showLoadingSpinner();
    let dataset;
    try {
        dataset = await loadDataset(tab);
    } catch (error) {
        if (currentTab === tab) showLoadError(error);
        return;
    }
    if (currentTab !== tab) return;   // another tab was opened while this one loaded
    data = dataset;

    renderFieldCheckboxes();
    refreshYearOptions();
    refreshCountryFilterOptions();
    displayRankings();
}

function loadDataset(tab) {
    if (!datasets[tab]) {
        datasets[tab] = buildDataset(TABS[tab]);
        datasets[tab].catch(() => { delete datasets[tab]; });
    }
    return datasets[tab];
}

function parseGroup(header) {
    const match = /^(.+)_(\d{4})$/.exec(header);
    const conference = match && conferences.find(c => c.id === match[1]);
    if (!conference) return null;
    return { key: header, conference: conference.id, field: conference.field, year: Number(match[2]) };
}

async function buildDataset(config) {
    const { headers, rows } = await loadCSV(config.rankingFile);
    const groups = [];
    const groupCols = [];
    headers.forEach((header, index) => {
        const group = parseGroup(header);
        if (group) {
            groups.push(group);
            groupCols.push(index);
        }
    });
    const col = name => headers.indexOf(name);
    const nameCol = col(config.entityCol);
    const entities = rows.filter(r => r[nameCol]).map(r => ({
        name: r[nameCol],
        key: searchKey(r[nameCol]),
        country: (r[col('Country')] || 'Unknown').trim(),
        continent: (r[col('Continent')] || 'Unknown').trim(),
        scores: groupCols.map(index => parseFloat(r[index]) || 0)
    }));

    const dataset = {
        config,
        groups,
        entities,
        byName: new Map(entities.map(e => [e.name, e])),
        people: null,          // Map(institution -> [{name, entries: [[groupIndex, score]]}])
        papers: null           // Promise of {institution: [paper]}, started when a row is first opened
    };
    computeFieldStats(dataset);

    // The people file is several times the size of the ranking, so the table is shown first.
    dataset.peopleReady = loadPeople(dataset)
        .then(() => { if (data === dataset && lastRanked.length) applySearch(); })
        .catch(error => { console.error(error); });
    return dataset;
}

async function loadPeople(dataset) {
    const { headers, rows } = await loadCSV(dataset.config.peopleFile);
    const indexByKey = new Map(dataset.groups.map((g, i) => [g.key, i]));
    const groupCols = [];
    headers.forEach((header, index) => {
        if (indexByKey.has(header)) groupCols.push([index, indexByKey.get(header)]);
    });
    const personCol = headers.indexOf(dataset.config.personCol);
    const entityCol = headers.indexOf(dataset.config.entityCol);

    const people = new Map();
    rows.forEach(r => {
        const entries = [];
        groupCols.forEach(([index, groupIndex]) => {
            const score = parseFloat(r[index]);
            if (score > 0) entries.push([groupIndex, score]);
        });
        if (!r[personCol] || !entries.length) return;
        if (!people.has(r[entityCol])) people.set(r[entityCol], []);
        people.get(r[entityCol]).push({
            name: r[personCol],
            key: searchKey(displayName(r[personCol])),
            entries
        });
    });
    dataset.people = people;
}

function computeFieldStats(dataset) {
    const sums = {};
    fields.forEach(field => { sums[field] = 0; });
    dataset.entities.forEach(entity => {
        entity.scores.forEach((score, i) => { sums[dataset.groups[i].field] += score; });
    });
    dataset.fieldScale = {};
    fields.forEach(field => {
        dataset.fieldScale[field] = sums[field] > EPS ? FIELD_TARGET_TOTAL / sums[field] : 0;
    });
    dataset.groupScale = dataset.groups.map(g => dataset.fieldScale[g.field]);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function conferencesOf(field) {
    const present = new Set(data ? data.groups.map(g => g.conference) : []);
    return conferences.filter(c => c.field === field && present.has(c.id));
}

function renderedConferences() {
    return fields.flatMap(conferencesOf);
}

function yearsOf(conferenceId) {
    return data.groups.filter(g => g.conference === conferenceId).map(g => g.year).sort((a, b) => a - b);
}

function renderFieldCheckboxes() {
    const container = document.getElementById('fieldCheckboxContainer');
    container.innerHTML = fields.filter(f => conferencesOf(f).length).map(field => {
        const expanded = expandedFields.has(field);
        const items = conferencesOf(field).map(conference => {
            const years = yearsOf(conference.id);
            const span = years[0] === years[years.length - 1]
                ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
            return `
                <label class="checkbox-item conference-item" title="${escapeHtml(conference.name)}: ${years.join(', ')}">
                    <input type="checkbox" class="field-checkbox conference-checkbox" data-conference="${escapeHtml(conference.id)}">
                    <span>${escapeHtml(conference.name)}</span>
                    <span class="conference-years">${span}</span>
                </label>
            `;
        }).join('');
        return `
            <div class="field-group" data-field="${escapeHtml(field)}">
                <div class="field-row">
                    <span class="field-caret${expanded ? ' expanded' : ''}" role="button" tabindex="0"
                          aria-expanded="${expanded}" title="Show conferences">▶</span>
                    <label class="checkbox-item" for="${toId(field)}">
                        <input type="checkbox" id="${toId(field)}" class="field-checkbox area-checkbox" data-field="${escapeHtml(field)}">
                        <span>${escapeHtml(field)}</span>
                    </label>
                </div>
                <div class="conference-list"${expanded ? '' : ' hidden'}>${items}</div>
            </div>
        `;
    }).join('');
    syncFieldCheckboxes();
}

// Checkbox state follows selectedConferences: a field is checked when all of its conferences
// are, and shown as partial when only some are.
function syncFieldCheckboxes() {
    document.querySelectorAll('.conference-checkbox').forEach(box => {
        box.checked = selectedConferences.has(box.dataset.conference);
    });
    document.querySelectorAll('.area-checkbox').forEach(box => {
        const ids = conferencesOf(box.dataset.field).map(c => c.id);
        const picked = ids.filter(id => selectedConferences.has(id)).length;
        box.checked = picked === ids.length;
        box.indeterminate = picked > 0 && picked < ids.length;
    });
    updateToggleAllFieldsButton();
}

function setupFieldFilter() {
    const container = document.getElementById('fieldCheckboxContainer');
    container.addEventListener('change', event => {
        const box = event.target;
        if (box.classList.contains('conference-checkbox')) {
            if (box.checked) selectedConferences.add(box.dataset.conference);
            else selectedConferences.delete(box.dataset.conference);
        } else if (box.classList.contains('area-checkbox')) {
            conferencesOf(box.dataset.field).forEach(c => {
                if (box.checked) selectedConferences.add(c.id);
                else selectedConferences.delete(c.id);
            });
        } else {
            return;
        }
        syncFieldCheckboxes();
        resetPageAndDisplayRankings();
    });

    const toggleField = caret => {
        const group = caret.closest('.field-group');
        const field = group.dataset.field;
        const expanded = !expandedFields.has(field);
        if (expanded) expandedFields.add(field);
        else expandedFields.delete(field);
        caret.classList.toggle('expanded', expanded);
        caret.setAttribute('aria-expanded', String(expanded));
        group.querySelector('.conference-list').hidden = !expanded;
    };
    container.addEventListener('click', event => {
        const caret = event.target.closest('.field-caret');
        if (caret) toggleField(caret);
    });
    container.addEventListener('keydown', event => {
        const caret = event.target.closest('.field-caret');
        if (caret && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleField(caret);
        }
    });
}

function toggleAllFields() {
    const shown = renderedConferences().map(c => c.id);
    const allChecked = shown.every(id => selectedConferences.has(id));
    shown.forEach(id => {
        if (allChecked) selectedConferences.delete(id);
        else selectedConferences.add(id);
    });
    syncFieldCheckboxes();
    resetPageAndDisplayRankings();
}

function updateToggleAllFieldsButton() {
    const shown = renderedConferences();
    const allChecked = shown.length > 0 && shown.every(c => selectedConferences.has(c.id));
    const button = document.getElementById('toggleAllFields');

    if (button) {
        button.textContent = allChecked ? 'None' : 'All';
    }
}

function toId(name) {
    return 'field-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function availableYears() {
    return Array.from(new Set(data.groups.map(g => g.year))).sort((a, b) => a - b);
}

function setupYearFilter() {
    const from = document.getElementById('yearFrom');
    const to = document.getElementById('yearTo');
    from.addEventListener('change', () => {
        yearFrom = Number(from.value);
        if (yearTo !== null && yearTo < yearFrom) yearTo = yearFrom;
        refreshYearOptions();
        resetPageAndDisplayRankings();
    });
    to.addEventListener('change', () => {
        yearTo = Number(to.value);
        if (yearFrom !== null && yearFrom > yearTo) yearFrom = yearTo;
        refreshYearOptions();
        resetPageAndDisplayRankings();
    });
}

function refreshYearOptions() {
    const years = availableYears();
    const options = years.map(y => `<option value="${y}">${y}</option>`).join('');
    const from = document.getElementById('yearFrom');
    const to = document.getElementById('yearTo');
    from.innerHTML = options;
    to.innerHTML = options;
    // A bound left at the edge of the data stays "unbounded", so it follows the data if a
    // tab covers a different span of years.
    if (yearFrom !== null && yearFrom <= years[0]) yearFrom = null;
    if (yearTo !== null && yearTo >= years[years.length - 1]) yearTo = null;
    from.value = yearFrom === null ? years[0] : yearFrom;
    to.value = yearTo === null ? years[years.length - 1] : yearTo;
}

function setupCountryFilter() {
    const sel = document.getElementById('countryFilter');
    sel.addEventListener('change', () => {
        selectedCountry = sel.value;
        resetPageAndDisplayRankings();
    });
}

function refreshCountryFilterOptions() {
    const sel = document.getElementById('countryFilter');

    // Get filtered data based on current region
    const filteredData = selectedRegion === 'all'
        ? data.entities
        : data.entities.filter(e => e.continent.toLowerCase() === selectedRegion.toLowerCase());

    // Extract unique countries from filtered data
    const countries = Array.from(new Set(
        filteredData
            .map(e => e.country)
            .filter(s => s && s.toLowerCase() !== 'unknown')
    )).sort((a, b) => a.localeCompare(b));

    // Rebuild dropdown options
    sel.innerHTML = '<option value="all">All Countries</option>' +
        countries.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    // Reset country selection if it's no longer available
    if (selectedCountry !== 'all' && !countries.includes(selectedCountry)) {
        selectedCountry = 'all';
    }
    sel.value = selectedCountry;
}

function setupRegionFilter() {
    const regionFilter = document.getElementById('regionFilter');
    regionFilter.addEventListener('change', () => {
        selectedRegion = regionFilter.value;
        refreshCountryFilterOptions(); // Update countries when region changes
        resetPageAndDisplayRankings();
    });
}

function resetPageAndDisplayRankings() {
    if (!data) return;
    expandedRows.clear(); // Clear expanded rows when filters change
    displayRankings();
}

// One flag per conference/year group: true when the filters keep it.
function activeGroups() {
    return data.groups.map(g =>
        selectedConferences.has(g.conference)
        && (yearFrom === null || g.year >= yearFrom)
        && (yearTo === null || g.year <= yearTo));
}

function getSelectedCategories(active = activeGroups()) {
    return fields.filter(field => data.groups.some((g, i) => active[i] && g.field === field));
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

function fieldScores(entity, active) {
    const scores = {};
    entity.scores.forEach((score, i) => {
        if (!active[i] || !(score > 0)) return;
        const field = data.groups[i].field;
        scores[field] = (scores[field] || 0) + score * data.groupScale[i];
    });
    return scores;
}

function totalScore(entity, active) {
    let total = 0;
    entity.scores.forEach((score, i) => {
        if (active[i]) total += score * data.groupScale[i];
    });
    return total;
}

function getPeopleForEntity(entityName, active) {
    const people = (data.people && data.people.get(entityName)) || [];

    return people.map(person => {
        // Main fields come from all of a person's scores, whatever the filters keep
        const allFieldScores = {};
        let shownScore = 0;
        person.entries.forEach(([groupIndex, score]) => {
            const field = data.groups[groupIndex].field;
            const normalizedScore = score * data.groupScale[groupIndex];
            allFieldScores[field] = (allFieldScores[field] || 0) + normalizedScore;
            if (active[groupIndex]) shownScore += normalizedScore;
        });

        const entries = Object.entries(allFieldScores);
        const maxScore = Math.max(0, ...entries.map(([, score]) => score));
        const threshold = maxScore * 0.3;
        const mainFields = entries
            .filter(([, score]) => score === maxScore || (maxScore > 0 && score >= threshold))
            .map(([field]) => field);

        return {
            name: person.name,
            // People the search found are listed first, so they are not lost in a long table
            matched: searchQuery.length >= 2 && person.key.includes(searchQuery),
            totalScore: shownScore,
            categories: fields.filter(f => mainFields.includes(f))
        };
    })
    .filter(person => person.totalScore > 0)  // Only show people with contributions under the filters
    .sort((a, b) => b.matched - a.matched || b.totalScore - a.totalScore);
}

// DBLP tells namesakes apart with a four-digit suffix ("Wei Wang 0001"); it is part of the
// DBLP name but not of the person's.
function displayName(name) {
    return name.replace(/\s\d{4}$/, '');
}

function generateGoogleScholarLink(facultyName) {
    const q = displayName(facultyName || '').trim().replace(/\s+/g, ' ');
    return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(q)}`;
}

function generateDBLPLink(facultyName) {
    // Clean name, remove special characters, join with spaces
    const cleanName = facultyName.replace(/[^\p{L}\p{N}_\s]/gu, '').replace(/\s+/g, ' ');
    return `https://dblp.org/search?q=author%3A${encodeURIComponent(cleanName.replace(/\s+/g,'_'))}%3A`;
}

function generatePaperLink(title) {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;
}

// ---------------------------------------------------------------------------
// Row details
// ---------------------------------------------------------------------------

function setupTableEvents() {
    const tableBody = document.querySelector('#rankingTable tbody');
    tableBody.addEventListener('click', event => {
        const showAll = event.target.closest('.show-all-people');
        if (showAll) {
            const detailsRow = showAll.closest('.faculty-details-row');
            renderPeople(detailsRow.querySelector('.people-section'), detailsRow.dataset.name, Infinity);
            return;
        }
        const row = event.target.closest('tr.university-row');
        if (!row || !data) return;
        if (event.target.closest('.chart-icon')) {
            toggleChartStats(row.dataset.name, row);
        } else if (event.target.closest('.expand-icon, .university-name')) {
            toggleUniversityDropdown(row.dataset.name, row);
        }
    });
}

// The detail and chart rows that belong to a ranking row sit directly after it.
function findAttachedRow(rowElement, className) {
    let next = rowElement.nextElementSibling;
    while (next && !next.classList.contains('university-row')) {
        if (next.classList.contains(className)) return next;
        next = next.nextElementSibling;
    }
    return null;
}

function toggleUniversityDropdown(universityName, rowElement) {
    const expandIcon = rowElement.querySelector('.expand-icon');

    if (expandedRows.has(universityName)) {
        // Collapse: Remove the details row
        const detailsRow = findAttachedRow(rowElement, 'faculty-details-row');
        if (detailsRow) detailsRow.remove();
        expandedRows.delete(universityName);
        expandIcon.innerHTML = '▶';
        expandIcon.classList.remove('expanded');
        return;
    }

    // Expand: Add the details row
    const detailsRow = document.createElement('tr');
    detailsRow.classList.add('faculty-details-row');
    detailsRow.dataset.name = universityName;
    detailsRow.innerHTML = `
        <td colspan="3"><div class="faculty-details">
            ${data.config.papersFile ? '<div class="papers-section"></div>' : ''}
            <div class="people-section"></div>
        </div></td>
    `;
    rowElement.insertAdjacentElement('afterend', detailsRow);
    expandedRows.add(universityName);
    expandIcon.innerHTML = '▼';
    expandIcon.classList.add('expanded');

    const dataset = data;
    const peopleSection = detailsRow.querySelector('.people-section');
    if (dataset.people) {
        renderPeople(peopleSection, universityName, PEOPLE_PAGE);
    } else {
        peopleSection.innerHTML = '<p class="details-note">Loading…</p>';
        dataset.peopleReady.then(() => {
            if (data === dataset && detailsRow.isConnected) {
                renderPeople(peopleSection, universityName, PEOPLE_PAGE);
            }
        });
    }
    if (dataset.config.papersFile) {
        renderPapers(detailsRow.querySelector('.papers-section'), universityName);
    }
}

function renderPeople(section, entityName, limit) {
    const config = data.config;
    if (!data.people) {
        section.innerHTML = `<p class="details-note">Could not load ${escapeHtml(config.peopleLabel.toLowerCase())}.</p>`;
        return;
    }
    const peopleList = getPeopleForEntity(entityName, activeGroups());
    if (peopleList.length === 0) {
        section.innerHTML = `<p class="details-note">${escapeHtml(config.emptyPeople)}</p>`;
        return;
    }

    let peopleHTML = '<div class="faculty-summary">';
    peopleHTML += `<h4><i class="fas fa-users"></i> ${escapeHtml(config.peopleLabel)} (${peopleList.length.toLocaleString()})</h4>`;
    peopleHTML += '</div>';

    peopleHTML += '<table class="faculty-table">';

    // CSRankings style header - just two columns
    peopleHTML += `
        <thead>
            <tr>
                <th class="faculty-name-col">${escapeHtml(config.personLabel)}</th>
                <th class="faculty-info-col">Information</th>
            </tr>
        </thead>
    `;
    peopleHTML += '<tbody>';

    peopleList.slice(0, limit).forEach(faculty => {
        const fieldsDisplayFull = faculty.categories.join(', ') || 'N/A';
        const googleScholarLink = generateGoogleScholarLink(faculty.name);
        const dblpLink = generateDBLPLink(faculty.name);

        // Create colored field badges
        const fieldsHTML = faculty.categories.length > 0
            ? faculty.categories.map(f => {
                const abbr = getFieldAbbreviation(f);
                const fieldClass = getFieldColorClass(f);
                return `<span class="field-badge ${fieldClass}" title="${escapeHtml(f)}">${escapeHtml(abbr)}</span>`;
            }).join(' ')
            : '<span class="field-badge field-default">N/A</span>';

        peopleHTML += `
            <tr class="faculty-row${faculty.matched ? ' search-hit' : ''}">
                <td class="faculty-name-cell">
                    <span class="faculty-name">${escapeHtml(displayName(faculty.name))}</span>
                    <span class="faculty-fields-display" title="Main Fields: ${escapeHtml(fieldsDisplayFull)}">
                        ${fieldsHTML}
                    </span>
                </td>
                <td class="faculty-info-cell">
                    <div class="faculty-info-links">
                        <span class="score-display" title="Contribution Score: ${faculty.totalScore.toFixed(4)}">
                            <i class="fas fa-chart-line"></i>
                            <span class="link-text">${faculty.totalScore.toFixed(4)}</span>
                        </span>
                        <a href="${escapeHtml(dblpLink)}" target="_blank" rel="noopener noreferrer" class="info-link" title="DBLP">
                            <i class="fas fa-file-alt"></i>
                        </a>
                        <a href="${escapeHtml(googleScholarLink)}" target="_blank" rel="noopener noreferrer" class="info-link" title="Google Scholar">
                            <i class="fas fa-graduation-cap"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    });

    peopleHTML += '</tbody></table>';
    if (peopleList.length > limit) {
        peopleHTML += `<button type="button" class="show-all-people">Show all ${peopleList.length.toLocaleString()}</button>`;
    }
    section.innerHTML = peopleHTML;
}

// All papers come in one file, fetched once, and not until a row is opened: most visits never
// open one.
function loadPapers(dataset) {
    if (!dataset.papers) {
        const request = fetch(dataset.config.papersFile).then(response => {
            if (!response.ok) throw new Error(`${dataset.config.papersFile}: ${response.status}`);
            return response.json();
        });
        request.catch(() => { dataset.papers = null; });   // let the next opened row retry
        dataset.papers = request;
    }
    return dataset.papers;
}

async function renderPapers(section, entityName) {
    const dataset = data;
    const heading = '<div class="faculty-summary"><h4><i class="fas fa-file-alt"></i> Most Cited Papers</h4></div>';
    section.innerHTML = heading + '<p class="details-note">Loading…</p>';

    let allPapers;
    try {
        allPapers = await loadPapers(dataset);
    } catch (error) {
        section.innerHTML = heading + '<p class="details-note">Could not load papers.</p>';
        return;
    }
    if (data !== dataset || !section.isConnected) return;

    // Count only the citations made by the conferences and years the filters keep
    const active = activeGroups();
    const activeKeys = new Set(dataset.groups.filter((g, i) => active[i]).map(g => g.key));
    const papers = (allPapers[entityName] || []).map(paper => {
        let citations = 0;
        Object.entries(paper.cites).forEach(([key, count]) => {
            if (activeKeys.has(key)) citations += count;
        });
        return { title: paper.title, year: paper.year, citations };
    })
    .filter(paper => paper.citations > 0)
    .sort((a, b) => b.citations - a.citations || a.title.localeCompare(b.title));

    if (papers.length === 0) {
        section.innerHTML = heading + '<p class="details-note">No papers cited by the selected conferences and years.</p>';
        return;
    }

    const items = papers.slice(0, TOP_PAPERS).map(paper => {
        const meta = [];
        if (paper.year) meta.push(String(paper.year));
        meta.push(`${paper.citations.toLocaleString()} citing paper${paper.citations !== 1 ? 's' : ''}`);
        return `
            <li>
                <a href="${escapeHtml(generatePaperLink(paper.title))}" target="_blank" rel="noopener noreferrer" class="paper-title">${escapeHtml(paper.title)}</a>
                <span class="paper-meta" title="Papers at the selected conferences and years that named this among their five most important references">${escapeHtml(meta.join(' · '))}</span>
            </li>
        `;
    }).join('');
    const more = papers.length > TOP_PAPERS
        ? `<p class="details-note">Top ${TOP_PAPERS} of ${papers.length.toLocaleString()} cited papers.</p>` : '';
    section.innerHTML = heading + `<ol class="paper-list">${items}</ol>` + more;
}

function getFieldAbbreviation(field) {
    const abbreviations = {
        'Machine Learning': 'ML',
        'Computer Vision & Image Processing': 'Vision',
        'Natural Language Processing': 'NLP',
        'Artificial Intelligence': 'AI',
        'The Web & Information Retrieval': 'WEB+IR',
        'Computer Architecture': 'Arch',
        'Computer Networks': 'Networks',
        'Computer Security': 'Security',
        'Databases': 'DB',
        'Design Automation': 'EDA',
        'Embedded & Real-time Systems': 'Embedded',
        'High-performance Computing': 'HPC',
        'Mobile Computing': 'Mobile',
        'Measurement & Performance Analysis': 'Metrics',
        'Operating Systems': 'OS',
        'Programming Languages': 'PL',
        'Software Engineering': 'SE',
        'Algorithms & Complexity': 'Theory',
        'Cryptography': 'Crypto',
        'Logic & Verification': 'Logic',
        'Computational Biology': 'Comp. Bio',
        'Computer Graphics': 'Graphics',
        'Computer Science Education': 'CSEd',
        'Economics & Computation': 'ECom',
        'Human-Computer Interaction': 'HCI',
        'Robotics': 'Robotics',
        'Visualization': 'Visualization'
    };
    return abbreviations[field] || field.substring(0, 8);
}

function getFieldColorClass(field) {
    const colorClasses = {
        'Machine Learning': 'field-ml',
        'Computer Vision & Image Processing': 'field-vision',
        'Natural Language Processing': 'field-nlp',
        'The Web & Information Retrieval': 'field-web-ir'
    };
    return colorClasses[field] || 'field-default';
}

// ---------------------------------------------------------------------------
// Ranking table
// ---------------------------------------------------------------------------

function displayRankings() {
    showLoadingSpinner();
    const dataset = data;

    // Simulate loading delay for better UX
    setTimeout(() => {
        if (data !== dataset) return;
        const calculatedScores = [];
        const active = activeGroups();

        data.entities.forEach(entity => {
            if (selectedRegion !== 'all'
                    && entity.continent.toLowerCase() !== selectedRegion.toLowerCase()) {
                return;
            }
            if (selectedCountry !== 'all' && entity.country !== selectedCountry) return;

            const score = totalScore(entity, active);
            if (score > 0) {
                calculatedScores.push({
                    name: entity.name,
                    Continent: entity.continent,
                    Country: entity.country,
                    Score: score
                });
            }
        });

        calculatedScores.sort((a, b) => b.Score - a.Score || a.name.localeCompare(b.name));
        calculatedScores.forEach((row, index) => { row.rank = index + 1; });

        lastRanked = calculatedScores;
        applySearch();
        hideLoadingSpinner();
    }, 300);
}

// Lower-case and accent-free, so "zurich" finds "Zürich" and "hyvarinen" finds "Hyvärinen".
function searchKey(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function setupSearch() {
    const input = document.getElementById('searchInput');
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            searchQuery = searchKey(input.value);
            if (!data) return;
            expandedRows.clear();
            applySearch();
        }, 150);
    });
}

// People of an institution whose name matches the search and who score under the filters.
function matchingPeople(entityName, active) {
    if (searchQuery.length < 2 || !data.people) return [];
    return (data.people.get(entityName) || []).filter(person =>
        person.key.includes(searchQuery)
        && person.entries.some(([groupIndex]) => active[groupIndex]));
}

// The search narrows the table without re-ranking: a row keeps the rank it has among everything
// the filters keep. A row is shown when its own name matches or one of its people does.
function applySearch() {
    let rows = lastRanked;
    if (searchQuery) {
        const active = activeGroups();
        rows = [];
        lastRanked.forEach(row => {
            const people = matchingPeople(row.name, active);
            if (data.byName.get(row.name).key.includes(searchQuery) || people.length) {
                rows.push({ ...row, matches: people.map(person => displayName(person.name)) });
            }
        });
    }
    lastFiltered = rows;
    updateStats(rows);
    displayAllRankings(rows);
}

function displayAllRankings(rows) {
    const tableBody = document.querySelector('#rankingTable tbody');

    if (rows.length === 0) {
        const message = selectedConferences.size === 0
            ? 'Select at least one field or conference.'
            : searchQuery && lastRanked.length
                ? `Nothing matches "${document.getElementById('searchInput').value.trim()}".`
                : 'Nothing matches the selected filters.';
        tableBody.innerHTML = `<tr><td colspan="3" class="empty-row">${escapeHtml(message)}</td></tr>`;
        return;
    }

    tableBody.innerHTML = rows.map(row => {
        // Name the people the search found, so it is clear why the row is listed
        const matches = row.matches || [];
        const matchHtml = matches.length
            ? `<span class="search-match" title="${escapeHtml(matches.join(', '))}">${escapeHtml(matches.slice(0, 3).join(', '))}${matches.length > 3 ? ` +${matches.length - 3} more` : ''}</span>`
            : '';
        const countryFlag = getCountryFlag(row.Country);
        const flagHtml = countryFlag ? `<img src="${countryFlag}" alt="${escapeHtml(row.Country)}" title="${escapeHtml(row.Country)}" class="country-flag-img" loading="lazy" onerror="this.style.display='none'">` : '';

        return `
            <tr class="university-row fade-in" data-name="${escapeHtml(row.name)}">
                <td class="rank-col">${row.rank}</td>
                <td class="institution-col university-name-cell">
                    <span class="expand-icon">▶</span>
                    <span class="university-name" title="View details">${escapeHtml(row.name)}</span>
                    ${flagHtml}
                    <i class="fas fa-chart-bar chart-icon" title="View field statistics"></i>
                    ${matchHtml}
                </td>
                <td class="score-col">
                    <span class="score-value">${row.Score.toFixed(2)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function showLoadingSpinner() {
    document.getElementById('loadingSpinner').style.display = 'flex';
}

function hideLoadingSpinner() {
    document.getElementById('loadingSpinner').style.display = 'none';
}

function showLoadError(error) {
    console.error(error);
    hideLoadingSpinner();
    document.querySelector('#rankingTable tbody').innerHTML =
        '<tr><td colspan="3" class="empty-row">Could not load the ranking data. Please try reloading the page.</td></tr>';
}

function updateStats(rows) {
    const totalUniversities = rows.length;

    document.getElementById('totalUniversities').textContent = totalUniversities.toLocaleString();
    document.getElementById('activeFilters').textContent = getActiveFilterCount();
    document.getElementById('totalCount').textContent = totalUniversities.toLocaleString();

    // Count unique people credited at the listed institutions under the current filters
    if (!data || !data.people) {
        document.getElementById('totalScore').textContent = '…';
        return;
    }
    const active = activeGroups();
    const uniqueAuthors = new Set();
    rows.forEach(row => {
        (data.people.get(row.name) || []).forEach(person => {
            if (person.entries.some(([groupIndex]) => active[groupIndex])) {
                uniqueAuthors.add(person.name);
            }
        });
    });
    document.getElementById('totalScore').textContent = uniqueAuthors.size.toLocaleString();
}

function getActiveFilterCount() {
    let count = 0;
    if (selectedRegion !== 'all') count++;
    if (selectedCountry !== 'all') count++;
    if (yearFrom !== null || yearTo !== null) count++;
    if (searchQuery) count++;
    if (!renderedConferences().every(c => selectedConferences.has(c.id))) count++;
    return count;
}

// Country name to country code mapping
const COUNTRY_NAME_TO_CODE = {
    'United States': 'us', 'Canada': 'ca', 'United Kingdom': 'gb', 'Germany': 'de',
    'France': 'fr', 'Italy': 'it', 'Spain': 'es', 'Netherlands': 'nl', 'Sweden': 'se',
    'Norway': 'no', 'Denmark': 'dk', 'Finland': 'fi', 'Switzerland': 'ch', 'Austria': 'at',
    'Belgium': 'be', 'Ireland': 'ie', 'Poland': 'pl', 'Czech Republic': 'cz', 'Hungary': 'hu',
    'Slovakia': 'sk', 'Slovenia': 'si', 'Croatia': 'hr', 'Romania': 'ro', 'Bulgaria': 'bg',
    'Greece': 'gr', 'Cyprus': 'cy', 'Malta': 'mt', 'Luxembourg': 'lu', 'Estonia': 'ee',
    'Latvia': 'lv', 'Lithuania': 'lt', 'Portugal': 'pt', 'Russia': 'ru', 'Ukraine': 'ua',
    'Belarus': 'by', 'Moldova': 'md', 'Turkey': 'tr', 'Israel': 'il', 'United Arab Emirates': 'ae',
    'Saudi Arabia': 'sa', 'Qatar': 'qa', 'Kuwait': 'kw', 'Bahrain': 'bh', 'Oman': 'om',
    'Yemen': 'ye', 'Jordan': 'jo', 'Lebanon': 'lb', 'Syria': 'sy', 'Iraq': 'iq', 'Iran': 'ir',
    'China': 'cn', 'Japan': 'jp', 'South Korea': 'kr', 'Taiwan': 'tw', 'Hong Kong': 'hk',
    'Singapore': 'sg', 'Malaysia': 'my', 'Thailand': 'th', 'Vietnam': 'vn', 'Philippines': 'ph',
    'Indonesia': 'id', 'Myanmar': 'mm', 'Laos': 'la', 'Cambodia': 'kh', 'Brunei': 'bn',
    'India': 'in', 'Pakistan': 'pk', 'Bangladesh': 'bd', 'Sri Lanka': 'lk', 'Maldives': 'mv',
    'Nepal': 'np', 'Bhutan': 'bt', 'Afghanistan': 'af', 'Uzbekistan': 'uz', 'Kazakhstan': 'kz',
    'Kyrgyzstan': 'kg', 'Tajikistan': 'tj', 'Turkmenistan': 'tm', 'Mongolia': 'mn',
    'Australia': 'au', 'New Zealand': 'nz', 'Fiji': 'fj', 'Papua New Guinea': 'pg',
    'Solomon Islands': 'sb', 'Vanuatu': 'vu', 'New Caledonia': 'nc', 'French Polynesia': 'pf',
    'Samoa': 'ws', 'Tonga': 'to', 'Kiribati': 'ki', 'Tuvalu': 'tv', 'Nauru': 'nr',
    'South Africa': 'za', 'Egypt': 'eg', 'Libya': 'ly', 'Tunisia': 'tn', 'Algeria': 'dz',
    'Morocco': 'ma', 'Sudan': 'sd', 'South Sudan': 'ss', 'Ethiopia': 'et', 'Eritrea': 'er',
    'Djibouti': 'dj', 'Somalia': 'so', 'Kenya': 'ke', 'Uganda': 'ug', 'Tanzania': 'tz',
    'Rwanda': 'rw', 'Burundi': 'bi', 'Malawi': 'mw', 'Zambia': 'zm', 'Zimbabwe': 'zw',
    'Botswana': 'bw', 'Namibia': 'na', 'Eswatini': 'sz', 'Lesotho': 'ls', 'Madagascar': 'mg',
    'Mauritius': 'mu', 'Seychelles': 'sc', 'Comoros': 'km', 'Mayotte': 'yt', 'RÃ©union': 're',
    'Mozambique': 'mz', 'Angola': 'ao', 'Democratic Republic of the Congo': 'cd',
    'Republic of the Congo': 'cg', 'Gabon': 'ga', 'Equatorial Guinea': 'gq',
    'SÃ£o TomÃ© and PrÃ­ncipe': 'st', 'Cameroon': 'cm', 'Central African Republic': 'cf',
    'Chad': 'td', 'Niger': 'ne', 'Nigeria': 'ng', 'Benin': 'bj', 'Burkina Faso': 'bf',
    'Mali': 'ml', 'Senegal': 'sn', 'Gambia': 'gm', 'Guinea': 'gn', 'Guinea-Bissau': 'gw',
    'Sierra Leone': 'sl', 'Liberia': 'lr', 'Ivory Coast': 'ci', 'Ghana': 'gh', 'Togo': 'tg',
    'Cape Verde': 'cv', 'Macao': 'mo', 'Macau': 'mo',
    'Argentina': 'ar', 'Brazil': 'br', 'Chile': 'cl', 'Colombia': 'co'
};

function getCountryFlag(country) {
    const countryCode = COUNTRY_NAME_TO_CODE[country];
    return countryCode ? `https://flagcdn.com/20x15/${countryCode}.png` : '';
}

function getFieldDisplayName(field) {
    const displayNames = {
        'Machine Learning': 'Machine Learning',
        'Computer Vision & Image Processing': 'Computer Vision',
        'Natural Language Processing': 'Natural Language Processing',
        'The Web & Information Retrieval': 'The Web & Information Retrieval'
    };
    return displayNames[field] || field;
}

function getPerFieldMaxMapNormalized(active) {
    const maxMap = {};
    data.entities.forEach(entity => {
        Object.entries(fieldScores(entity, active)).forEach(([field, score]) => {
            maxMap[field] = Math.max(maxMap[field] || 0, score);
        });
    });
    return maxMap;
}

function toggleChartStats(universityName, row) {
    const existing = findAttachedRow(row, 'chart-stats-row');
    if (existing) {
        existing.remove();
        return;
    }

    const entity = data.byName.get(universityName);
    if (!entity) return;

    const active = activeGroups();
    const scores = fieldScores(entity, active);
    const chartData = getSelectedCategories(active)
        .filter(field => scores[field] > 0)
        .map(field => ({ field, score: scores[field] }));   // use normalized score

    if (chartData.length === 0) return;

    const perFieldMax = getPerFieldMaxMapNormalized(active);

    const chartRow = document.createElement('tr');
    chartRow.classList.add('chart-stats-row');

    let chartHTML = '<td colspan="3"><div class="chart-stats-container">';
    chartHTML += '<h4>Field Statistics</h4>';
    chartHTML += '<div class="chart-bars">';

    chartData.forEach(item => {
        const cap = perFieldMax[item.field] || 1;
        const pct = Math.min(100, (item.score / cap) * 100);
        chartHTML += `
            <div class="chart-bar-item">
              <div class="chart-bar-label">${escapeHtml(getFieldDisplayName(item.field))}</div>
              <div class="chart-bar-container">
                <div class="chart-bar" style="width:${pct}%"></div>
                <div class="chart-bar-value">${item.score.toFixed(2)}</div>
              </div>
            </div>
        `;
    });

    chartHTML += '</div></div></td>';
    chartRow.innerHTML = chartHTML;
    row.parentNode.insertBefore(chartRow, row.nextSibling);
}

function exportData() {
    if (lastFiltered.length === 0) {
        alert('No data to export');
        return;
    }

    const quote = value => /[",\n]/.test(String(value))
        ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    const csvContent = [
        ['Rank', data.config.entityCol, 'Continent', 'Country', 'Impact Score'],
        ...lastFiltered.map(row => [
            row.rank,
            row.name,
            row.Continent,
            row.Country,
            row.Score.toFixed(2)
        ])
    ].map(row => row.map(quote).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.config.exportName}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function showAbout() {
    alert('AI Research Impact Rankings\n\nThis ranking system measures academic excellence through research influence and impact, using LLM analysis to identify the most important references in academic papers.\n\nBuilt with ❤️ for academic transparency.');
}

function toggleDemoNotice() {
    const notice = document.querySelector('.demo-notice');
    notice.style.display = 'none';
    document.querySelector('.main-header').style.marginTop = '0';
}

function toggleDescription(event) {
    event.preventDefault();
    descriptionExpanded = !descriptionExpanded;
    updateDescription();
}

// Each tab has its own description; the "read more" state carries over between them.
function updateDescription() {
    document.querySelectorAll('.tab-description').forEach(block => {
        block.style.display = block.dataset.tab === currentTab ? '' : 'none';
        block.querySelector('.description-short').style.display = descriptionExpanded ? 'none' : 'inline';
        block.querySelector('.description-full').style.display = descriptionExpanded ? 'inline' : 'none';
    });
    document.getElementById('readMoreLink').textContent = descriptionExpanded ? 'read less' : 'read more';
}

// Initialize the application
initialize();
