pub mod oracle_job {
    include!("oracle_job.rs");
}
pub use oracle_job::*;

pub mod oracle_job_serde {
    use crate::oracle_job::*;
    include!("oracle_job.serde.rs");
}
