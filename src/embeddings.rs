use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const EMBEDDING_DIM: usize = 128;

pub struct Embedder {
    vocab: Vec<String>,
}

impl Embedder {
    pub fn new() -> Self {
        Self {
            vocab: Vec::new(),
        }
    }

    pub fn embed(&mut self, texts: &[String]) -> Vec<Vec<f32>> {
        self.build_vocab(texts);
        texts.iter().map(|t| self.embed_single(t)).collect()
    }

    fn build_vocab(&mut self, texts: &[String]) {
        let mut unique: Vec<String> = texts
            .iter()
            .flat_map(|t| t.split_whitespace().map(String::from).collect::<Vec<_>>())
            .collect();
        unique.sort();
        unique.dedup();
        self.vocab = unique;
    }

    fn embed_single(&self, text: &str) -> Vec<f32> {
        let mut embedding = vec![0.0; EMBEDDING_DIM];
        let tokens: Vec<&str> = text.split_whitespace().collect();

        for (i, token) in tokens.iter().enumerate() {
            let hash = self.hash_token(token);
            let dim = hash % EMBEDDING_DIM;
            let weight = 1.0 / (1.0 + i as f32);
            embedding[dim] += weight;
        }

        self.normalize(&embedding)
    }

    fn hash_token(&self, token: &str) -> usize {
        let mut hasher = DefaultHasher::new();
        token.hash(&mut hasher);
        hasher.finish() as usize
    }

    fn normalize(&self, vec: &[f32]) -> Vec<f32> {
        let sum: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if sum == 0.0 {
            return vec.to_vec();
        }
        vec.iter().map(|x| x / sum).collect()
    }

    pub fn dim() -> usize {
        EMBEDDING_DIM
    }
}

impl Default for Embedder {
    fn default() -> Self {
        Self::new()
    }
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embed() {
        let mut embedder = Embedder::new();
        let texts = vec![
            "error 502 nginx".to_string(),
            "servidor caido".to_string(),
        ];
        let embeddings = embedder.embed(&texts);
        assert_eq!(embeddings.len(), 2);
        assert_eq!(embeddings[0].len(), EMBEDDING_DIM);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let c = vec![0.0, 1.0, 0.0];

        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);
        assert!(cosine_similarity(&a, &c).abs() < 0.001);
    }
}