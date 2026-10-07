use std::path::{Path, PathBuf};
use std::fs;

fn canon_or_raw(p: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in p.components() {
        match component {
            std::path::Component::ParentDir => {
                let can_pop = matches!(
                    normalized.components().next_back(),
                    Some(std::path::Component::Normal(_))
                );
                if can_pop {
                    normalized.pop();
                } else if !normalized.has_root() {
                    normalized.push(component);
                }
            }
            std::path::Component::CurDir => {}
            _ => normalized.push(component),
        }
    }
    normalized
}

fn secure_canonicalize(path: &Path) -> PathBuf {
    let mut p = PathBuf::new();
    for component in path.components() {
        p.push(component);
        if let Ok(canon) = fs::canonicalize(&p) {
            p = canon;
        }
    }
    // We still need to run canon_or_raw because non-existent parts
    // (e.g. trailing ".." or ".") were pushed but not canonicalized by fs::canonicalize
    canon_or_raw(&p)
}

fn path_allowed(candidate: &Path, allowed: &[PathBuf]) -> bool {
    let c = secure_canonicalize(candidate);
    allowed.iter().any(|a| secure_canonicalize(a) == c)
}

fn main() {
    let temp = std::env::temp_dir();
    let real_allowed = temp.join("allowed_dir_abc");
    fs::create_dir_all(&real_allowed).unwrap();
    let secret = temp.join("secret_dir_xyz");
    fs::create_dir_all(&secret).unwrap();

    // Attacker makes a symlink from allowed/sym -> target
    let symlink = real_allowed.join("sym");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&secret, &symlink).unwrap_or(());

    let malicious = symlink.join("..").join("secret_dir_xyz").join("new_file");
    println!("Does malicious match? {}", path_allowed(&malicious, &[real_allowed.clone()]));
}
