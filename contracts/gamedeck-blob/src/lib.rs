use freenet_stdlib::prelude::*;
use sha2::{Digest, Sha256};

const PARAMETER_BYTES: usize = 41;
const PARAMETER_VERSION: u8 = 1;

pub struct Contract;

fn expected(parameters: &Parameters<'static>) -> Result<([u8; 32], usize), ContractError> {
    let bytes = parameters.as_ref();
    if bytes.len() != PARAMETER_BYTES || bytes[0] != PARAMETER_VERSION {
        return Err(ContractError::InvalidState);
    }
    let mut hash = [0_u8; 32];
    hash.copy_from_slice(&bytes[1..33]);
    let size_bytes: [u8; 8] = bytes[33..41]
        .try_into()
        .map_err(|_| ContractError::InvalidState)?;
    let size = u64::from_le_bytes(size_bytes);
    usize::try_from(size).map(|value| (hash, value)).map_err(|_| ContractError::InvalidState)
}

fn digest(state: &[u8]) -> [u8; 32] {
    Sha256::digest(state).into()
}

fn validate_blob(parameters: &Parameters<'static>, state: &State<'static>) -> Result<(), ContractError> {
    let (expected_hash, expected_size) = expected(parameters)?;
    let bytes = state.as_ref();
    if bytes.len() != expected_size || digest(bytes) != expected_hash {
        return Err(ContractError::InvalidState);
    }
    Ok(())
}

#[contract]
impl ContractInterface for Contract {
    fn validate_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        _related: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        validate_blob(&parameters, &state)?;
        Ok(ValidateResult::Valid)
    }

    fn update_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        data: Vec<UpdateData<'static>>,
    ) -> Result<UpdateModification<'static>, ContractError> {
        validate_blob(&parameters, &state)?;
        if data.is_empty() {
            return Ok(UpdateModification::valid(state));
        }
        for update in data {
            let candidate = match update {
                UpdateData::State(value) => value.as_ref().to_vec(),
                UpdateData::Delta(value) => value.as_ref().to_vec(),
                UpdateData::StateAndDelta { state, delta } if delta.is_empty() => state.as_ref().to_vec(),
                _ => return Err(ContractError::InvalidUpdate),
            };
            let candidate_state = State::from(candidate);
            validate_blob(&parameters, &candidate_state)?;
            if candidate_state.as_ref() != state.as_ref() {
                return Err(ContractError::InvalidUpdate);
            }
        }
        Ok(UpdateModification::valid(state))
    }

    fn summarize_state(
        parameters: Parameters<'static>,
        state: State<'static>,
    ) -> Result<StateSummary<'static>, ContractError> {
        validate_blob(&parameters, &state)?;
        Ok(StateSummary::from(digest(state.as_ref()).to_vec()))
    }

    fn get_state_delta(
        parameters: Parameters<'static>,
        state: State<'static>,
        summary: StateSummary<'static>,
    ) -> Result<StateDelta<'static>, ContractError> {
        validate_blob(&parameters, &state)?;
        if summary.as_ref() == digest(state.as_ref()) {
            Ok(StateDelta::from(Vec::<u8>::new()))
        } else {
            Ok(StateDelta::from(state.as_ref().to_vec()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parameters(bytes: &[u8]) -> Parameters<'static> {
        let hash = digest(bytes);
        let mut value = vec![PARAMETER_VERSION];
        value.extend_from_slice(&hash);
        value.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        Parameters::from(value)
    }

    #[test]
    fn accepts_exact_blob() {
        let bytes = b"GameDeck verified blob".to_vec();
        let result = Contract::validate_state(
            parameters(&bytes),
            State::from(bytes),
            Default::default(),
        );
        assert!(matches!(result, Ok(ValidateResult::Valid)));
    }

    #[test]
    fn rejects_modified_blob() {
        let expected = b"GameDeck verified blob".to_vec();
        let modified = b"GameDeck poisoned blob".to_vec();
        let result = Contract::validate_state(
            parameters(&expected),
            State::from(modified),
            Default::default(),
        );
        assert!(matches!(result, Err(ContractError::InvalidState)));
    }
}
