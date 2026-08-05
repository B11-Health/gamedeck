use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const PARAMETERS_LEN: usize = 33;
const PARAMETERS_VERSION: u8 = 1;
const STATE_VERSION: u8 = 1;
const MAX_MESSAGES: usize = 200;
const MAX_TEXT_BYTES: usize = 600;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    version: u8,
    id: String,
    author_name: String,
    created_at: u64,
    text: String,
    author_public_key: String,
    signature: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatState {
    version: u8,
    messages: Vec<ChatMessage>,
}

pub struct Contract;

fn topic_hash(parameters: &Parameters<'static>) -> Result<[u8; 32], ContractError> {
    let bytes = parameters.as_ref();
    if bytes.len() != PARAMETERS_LEN || bytes[0] != PARAMETERS_VERSION {
        return Err(ContractError::InvalidState);
    }
    let mut topic = [0_u8; 32];
    topic.copy_from_slice(&bytes[1..33]);
    Ok(topic)
}

fn safe_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.chars().any(|ch| ch == '\0' || ch == '\r' || ch.is_control() && ch != '\n')
}

fn signature_message(message: &ChatMessage, topic: &[u8; 32]) -> String {
    [
        "GDCHAT1".to_owned(),
        message.id.clone(),
        hex::encode(topic),
        message.author_name.clone(),
        message.created_at.to_string(),
        message.text.clone(),
    ]
    .join("\n")
}

fn validate_message(message: &ChatMessage, topic: &[u8; 32]) -> Result<(), ContractError> {
    if message.version != 1
        || !safe_text(&message.id, 80)
        || !message.id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        || !safe_text(&message.author_name, 40)
        || message.created_at == 0
        || !safe_text(&message.text, MAX_TEXT_BYTES)
    {
        return Err(ContractError::InvalidState);
    }
    let public_key: [u8; 32] = hex::decode(&message.author_public_key)
        .map_err(|_| ContractError::InvalidState)?
        .try_into()
        .map_err(|_| ContractError::InvalidState)?;
    let signature: [u8; 64] = hex::decode(&message.signature)
        .map_err(|_| ContractError::InvalidState)?
        .try_into()
        .map_err(|_| ContractError::InvalidState)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| ContractError::InvalidState)?;
    verifying_key
        .verify(signature_message(message, topic).as_bytes(), &Signature::from_bytes(&signature))
        .map_err(|_| ContractError::InvalidState)
}

fn parse_state(parameters: &Parameters<'static>, bytes: &[u8]) -> Result<ChatState, ContractError> {
    let topic = topic_hash(parameters)?;
    if bytes.is_empty() {
        return Ok(ChatState { version: STATE_VERSION, messages: Vec::new() });
    }
    let state: ChatState = serde_json::from_slice(bytes).map_err(|e| ContractError::Deser(e.to_string()))?;
    if state.version != STATE_VERSION || state.messages.len() > MAX_MESSAGES {
        return Err(ContractError::InvalidState);
    }
    let mut ids = HashSet::new();
    for message in &state.messages {
        validate_message(message, &topic)?;
        if !ids.insert(message.id.clone()) {
            return Err(ContractError::InvalidState);
        }
    }
    Ok(state)
}

fn merge_state(base: &mut ChatState, update: ChatState) {
    for message in update.messages {
        if base.messages.iter().any(|existing| existing.id == message.id) {
            continue;
        }
        base.messages.push(message);
    }
    base.messages.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
    if base.messages.len() > MAX_MESSAGES {
        base.messages.drain(0..base.messages.len() - MAX_MESSAGES);
    }
    base.version = STATE_VERSION;
}

fn state_hash(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

#[contract]
impl ContractInterface for Contract {
    fn validate_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        _related: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        parse_state(&parameters, state.as_ref())?;
        Ok(ValidateResult::Valid)
    }

    fn update_state(
        parameters: Parameters<'static>,
        state: State<'static>,
        data: Vec<UpdateData<'static>>,
    ) -> Result<UpdateModification<'static>, ContractError> {
        let mut merged = parse_state(&parameters, state.as_ref())?;
        for update in data {
            match update {
                UpdateData::State(value) => {
                    merge_state(&mut merged, parse_state(&parameters, value.as_ref())?);
                }
                UpdateData::Delta(value) => {
                    merge_state(&mut merged, parse_state(&parameters, value.as_ref())?);
                }
                UpdateData::StateAndDelta { state, delta } => {
                    if !state.is_empty() {
                        merge_state(&mut merged, parse_state(&parameters, state.as_ref())?);
                    }
                    if !delta.is_empty() {
                        merge_state(&mut merged, parse_state(&parameters, delta.as_ref())?);
                    }
                }
                _ => return Err(ContractError::InvalidUpdate),
            }
        }
        let bytes = serde_json::to_vec(&merged).map_err(|e| ContractError::Other(e.to_string()))?;
        Ok(UpdateModification::valid(State::from(bytes)))
    }

    fn summarize_state(
        parameters: Parameters<'static>,
        state: State<'static>,
    ) -> Result<StateSummary<'static>, ContractError> {
        parse_state(&parameters, state.as_ref())?;
        Ok(StateSummary::from(state_hash(state.as_ref())))
    }

    fn get_state_delta(
        parameters: Parameters<'static>,
        state: State<'static>,
        summary: StateSummary<'static>,
    ) -> Result<StateDelta<'static>, ContractError> {
        parse_state(&parameters, state.as_ref())?;
        if summary.as_ref() == state_hash(state.as_ref()) {
            Ok(StateDelta::from(Vec::<u8>::new()))
        } else {
            Ok(StateDelta::from(state.as_ref().to_vec()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn parameters() -> Parameters<'static> {
        let mut value = vec![1_u8];
        value.extend_from_slice(&[9_u8; 32]);
        Parameters::from(value)
    }

    fn signed_message() -> ChatMessage {
        let signing = SigningKey::from_bytes(&[11_u8; 32]);
        let mut message = ChatMessage {
            version: 1,
            id: "message-test-1".to_owned(),
            author_name: "Player One".to_owned(),
            created_at: 1_000,
            text: "Ready to play?".to_owned(),
            author_public_key: hex::encode(signing.verifying_key().to_bytes()),
            signature: String::new(),
        };
        let topic = topic_hash(&parameters()).unwrap();
        message.signature = hex::encode(signing.sign(signature_message(&message, &topic).as_bytes()).to_bytes());
        message
    }

    #[test]
    fn accepts_signed_message() {
        let state = ChatState { version: 1, messages: vec![signed_message()] };
        let result = Contract::validate_state(parameters(), State::from(serde_json::to_vec(&state).unwrap()), Default::default());
        assert!(matches!(result, Ok(ValidateResult::Valid)));
    }

    #[test]
    fn rejects_tampered_message() {
        let mut message = signed_message();
        message.text = "Tampered".to_owned();
        let state = ChatState { version: 1, messages: vec![message] };
        let result = Contract::validate_state(parameters(), State::from(serde_json::to_vec(&state).unwrap()), Default::default());
        assert!(matches!(result, Err(ContractError::InvalidState)));
    }
}
