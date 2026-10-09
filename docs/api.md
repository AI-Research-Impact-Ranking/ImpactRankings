# API Documentation

## Data File Format

The site reads everything from the `data/` directory. Each tab (Universities, Companies) is one
ranking file plus one people file, and both share the same score columns.

**Score columns.** Scores are computed separately for every conference and year, so each score
column is one conference/year group named `<CONFERENCE>_<YEAR>` (for example `ACL_2021`). An empty
cell means zero. An institution's score under any filter is the sum of the selected columns, each
multiplied by its field's scale (see [Score scale](#score-scale)).

### 1. conferences.csv

Which field each conference belongs to. Fields are listed on the page in the order they first
appear here.

```csv
Conference,Name,Category
ICML,ICML,Machine Learning
NEURIPS,NeurIPS,Machine Learning
...
```

- `Conference`: the name used in the score column headers
- `Name`: the name shown on the page
- `Category`: the research field

### 2. university_ranking.csv and company_ranking.csv

One row per institution.

```csv
University,Country,Continent,ACL_2021,ACL_2022,...
Tsinghua University,China,Asia,3.75112,3.57846,...
```

```csv
Company,Country,Continent,ACL_2021,ACL_2022,...
Google,United States,North America,39.33044,49.50947,...
```

- `University` / `Company`: institution name
- `Country`, `Continent`: `Unknown` when not known; such rows are hidden by the region and
  country filters
- one column per conference/year group

### 3. university_faculty.csv and company_authors.csv

One row per person per institution, with the same score columns.

```csv
Faculty Name,University,ACL_2021,ACL_2022,...
Author,Company,ACL_2021,ACL_2022,...
```

Names are DBLP names, so namesakes carry DBLP's four-digit suffix (`Wei Wang 0001`). The page
hides the suffix but keeps it in the DBLP link.

### 4. company_papers.json

One file for all companies, keyed by the company name used in `company_ranking.csv`: every cited
paper produced at that company and how many papers in each conference/year group named it among
their five most important references. It is fetched once, the first time a company row is opened.

```json
{"OpenAI": [{"title": "Learning transferable visual models from natural language supervision",
             "year": 2021,
             "cites": {"CVPR_2022": 33, "CVPR_2023": 98}}],
 "Google": [...]}
```

## Score scale

Each field is rescaled so that its scores sum to 500 across all institutions of a tab
(`FIELD_TARGET_TOTAL` in `app.js`). The scale is computed once from the full data, so narrowing
the conferences or years lowers scores rather than rescaling them.

## Configuration

The data files and labels of each tab are defined at the top of `app.js`:

```javascript
const TABS = {
    universities: {
        rankingFile: 'data/university_ranking.csv',
        peopleFile: 'data/university_faculty.csv',
        ...
    },
    companies: {
        rankingFile: 'data/company_ranking.csv',
        peopleFile: 'data/company_authors.csv',
        papersDir: 'data/company_papers',
        ...
    }
};
```

## Adding New Research Fields or Conferences

1. **Add the conference to `conferences.csv`** with its field. A new field needs no code change;
   it appears once a conference names it.
2. **Add its score columns** (`<CONFERENCE>_<YEAR>`) to the ranking and people files.
3. Optionally give a new field a badge abbreviation and color in `getFieldAbbreviation` and
   `getFieldColorClass` in `app.js`.

## Data Update Process

1. **Backend generates new CSV files**
2. **Replace files in `data/` directory**
3. **Deploy to AWS S3**:
   ```bash
   aws s3 sync public/ s3://your-bucket-name/ --delete
   ```
4. **CloudFront automatically serves updated files**

## Error Handling

The application includes error handling for:
- Missing data files
- Malformed CSV data
- Network errors
- Invalid data formats

Error messages are displayed to users via notification system.

## Performance Considerations

- **Data Size**: Optimized for datasets up to 10,000 universities
- **Loading**: Parallel data loading for faster initialization
- **Caching**: Static assets cached by CloudFront
- **Compression**: Gzip compression enabled
