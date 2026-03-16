use std::path::Path;
use std::sync::Mutex;

use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query};
use tantivy::schema::*;
use tantivy::directory::MmapDirectory;
use tantivy::{doc, Index, IndexReader, IndexSettings, IndexWriter, ReloadPolicy, Term};

pub struct SearchIndex {
    #[allow(dead_code)]
    index: Index,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    id_field: Field,
    title_field: Field,
    summary_field: Field,
    content_field: Field,
}

impl SearchIndex {
    pub fn new(index_path: &Path) -> tantivy::Result<Self> {
        std::fs::create_dir_all(index_path)?;

        let mut schema_builder = Schema::builder();
        let id_field = schema_builder.add_text_field("id", STRING | STORED);
        let title_field = schema_builder.add_text_field("title", TEXT);
        let summary_field = schema_builder.add_text_field("summary", TEXT);
        let content_field = schema_builder.add_text_field("content_md", TEXT);
        let schema = schema_builder.build();

        let mmap_dir = MmapDirectory::open(index_path)?;
        let index = if Index::exists(&mmap_dir)? {
            Index::open(mmap_dir)?
        } else {
            Index::create(mmap_dir, schema, IndexSettings::default())?
        };

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        let writer = index.writer(50_000_000)?; // 50MB heap

        Ok(Self {
            index,
            reader,
            writer: Mutex::new(writer),
            id_field,
            title_field,
            summary_field,
            content_field,
        })
    }

    pub fn doc_count(&self) -> u64 {
        let searcher = self.reader.searcher();
        searcher.num_docs()
    }

    pub fn add_document(
        &self,
        id: &str,
        title: &str,
        summary: &str,
        content_md: &str,
    ) -> tantivy::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        // Delete existing document with this id
        writer.delete_term(Term::from_field_text(self.id_field, id));
        writer.add_document(doc!(
            self.id_field => id,
            self.title_field => title,
            self.summary_field => summary,
            self.content_field => content_md,
        ))?;
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    pub fn delete_document(&self, id: &str) -> tantivy::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.delete_term(Term::from_field_text(self.id_field, id));
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    pub fn search(&self, query_str: &str, limit: usize) -> tantivy::Result<Vec<String>> {
        let searcher = self.reader.searcher();

        let query_str = query_str.trim();
        if query_str.is_empty() {
            return Ok(vec![]);
        }

        // Sanitize and split into terms
        let cleaned: String = query_str
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { ' ' })
            .collect();

        let terms: Vec<&str> = cleaned.split_whitespace().filter(|t| t.len() >= 2).collect();

        if terms.is_empty() {
            return Ok(vec![]);
        }

        // Build a boolean AND query: each term must match in at least one field
        let mut must_clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        for term_str in &terms {
            let distance = if term_str.len() >= 5 { 2 } else { 1 };

            // For each term, create a should query across all fields with boosts
            let field_queries: Vec<(Occur, Box<dyn Query>)> = vec![
                (
                    Occur::Should,
                    Box::new(BoostQuery::new(
                        Box::new(FuzzyTermQuery::new(
                            Term::from_field_text(self.title_field, &term_str.to_lowercase()),
                            distance,
                            true,
                        )),
                        3.0,
                    )),
                ),
                (
                    Occur::Should,
                    Box::new(BoostQuery::new(
                        Box::new(FuzzyTermQuery::new(
                            Term::from_field_text(self.summary_field, &term_str.to_lowercase()),
                            distance,
                            true,
                        )),
                        2.0,
                    )),
                ),
                (
                    Occur::Should,
                    Box::new(FuzzyTermQuery::new(
                        Term::from_field_text(self.content_field, &term_str.to_lowercase()),
                        distance,
                        true,
                    )),
                ),
            ];

            let term_query = BooleanQuery::new(field_queries);
            must_clauses.push((Occur::Must, Box::new(term_query)));
        }

        let final_query = BooleanQuery::new(must_clauses);
        let top_docs = searcher.search(&final_query, &TopDocs::with_limit(limit))?;

        let mut ids = Vec::new();
        for (_score, doc_address) in top_docs {
            let doc: TantivyDocument = searcher.doc(doc_address)?;
            if let Some(id_value) = doc.get_first(self.id_field) {
                if let Some(id_str) = id_value.as_str() {
                    ids.push(id_str.to_string());
                }
            }
        }

        Ok(ids)
    }

    pub fn reindex_all(
        &self,
        docs: &[(String, String, String, String)], // (id, title, summary, content_md)
    ) -> tantivy::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.delete_all_documents()?;
        for (id, title, summary, content_md) in docs {
            writer.add_document(doc!(
                self.id_field => id.as_str(),
                self.title_field => title.as_str(),
                self.summary_field => summary.as_str(),
                self.content_field => content_md.as_str(),
            ))?;
        }
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }
}
