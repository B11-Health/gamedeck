use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const PARAMETERS_LEN: usize = 65;
const PARAMETERS_VERSION: u8 = 1;
const STATE_VERSION: u8 = 1;
const MAX_ROOMS: usize = 64;
const MAX_INVITE_BYTES: usize = 32 * 1024;
const MAX_ROOM_LIFETIME_MS: u64 = 12 * 60 * 60 * 1000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Room {
    version: u8,
    room_id: String,
    title: String,
    system_id: String,
    host_name: String,
    max_players: u8,
    player_count: u8,
    created_at: u64,
    expires_at: u64,
    invite: String,
    status: String,
    host_public_key: String,
    signature: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomState {
    version: u8,
    rooms: Vec<Room>,
}

pub struct Contract;

fn match_hashes(parameters: &Parameters<'static>) -> Result<([u8; 32], [u8; 32]), ContractError> {
    let bytes = parameters.as_ref();
    if bytes.len() != PARAMETERS_LEN || bytes[0] != PARAMETERS_VERSION {
        return Err(ContractError::InvalidState);
    }
    let mut game = [0_u8; 32];
    let mut core = [0_u8; 32];
    game.copy_from_slice(&bytes[1..33]);
    core.copy_from_slice(&bytes[33..65]);
    Ok((game, core))
}

fn safe_text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.chars().any(|ch| ch == '\r' || ch == '\n' || ch == '\0' || ch.is_control())
}

fn signature_message(room: &Room, game: &[u8; 32], core: &[u8; 32]) -> String {
    [
        "GDROOM1".to_owned(),
        room.room_id.clone(),
        hex::encode(game),
        hex::encode(core),
        room.system_id.clone(),
        room.title.clone(),
        room.host_name.clone(),
        room.max_players.to_string(),
        room.player_count.to_string(),
        room.created_at.to_string(),
        room.expires_at.to_string(),
        room.invite.clone(),
        room.status.clone(),
    ]
    .join("\n")
}

fn validate_room(room: &Room, game: &[u8; 32], core: &[u8; 32]) -> Result<(), ContractError> {
    if room.version != 1
        || !safe_text(&room.room_id, 80)
        || !room.room_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        || !safe_text(&room.title, 160)
        || !safe_text(&room.system_id, 64)
        || !safe_text(&room.host_name, 40)
        || !(2..=16).contains(&room.max_players)
        || room.player_count == 0
        || room.player_count > room.max_players
        || room.expires_at <= room.created_at
        || room.expires_at - room.created_at > MAX_ROOM_LIFETIME_MS
        || room.invite.len() > MAX_INVITE_BYTES
        || !room.invite.starts_with("GDPLAY1.")
        || !matches!(room.status.as_str(), "open" | "closed")
    {
        return Err(ContractError::InvalidState);
    }

    let public_key: [u8; 32] = hex::decode(&room.host_public_key)
        .map_err(|_| ContractError::InvalidState)?
        .try_into()
        .map_err(|_| ContractError::InvalidState)?;
    let signature: [u8; 64] = hex::decode(&room.signature)
        .map_err(|_| ContractError::InvalidState)?
        .try_into()
        .map_err(|_| ContractError::InvalidState)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|_| ContractError::InvalidState)?;
    verifying_key
        .verify(signature_message(room, game, core).as_bytes(), &Signature::from_bytes(&signature))
        .map_err(|_| ContractError::InvalidState)
}

fn parse_state(parameters: &Parameters<'static>, bytes: &[u8]) -> Result<RoomState, ContractError> {
    let (game, core) = match_hashes(parameters)?;
    if bytes.is_empty() {
        return Ok(RoomState { version: STATE_VERSION, rooms: Vec::new() });
    }
    let state: RoomState = serde_json::from_slice(bytes).map_err(|e| ContractError::Deser(e.to_string()))?;
    if state.version != STATE_VERSION || state.rooms.len() > MAX_ROOMS {
        return Err(ContractError::InvalidState);
    }
    let mut room_ids = HashSet::new();
    let mut hosts = HashSet::new();
    for room in &state.rooms {
        validate_room(room, &game, &core)?;
        if !room_ids.insert(room.room_id.clone()) || !hosts.insert(room.host_public_key.clone()) {
            return Err(ContractError::InvalidState);
        }
    }
    Ok(state)
}

fn merge_state(base: &mut RoomState, update: RoomState) {
    for room in update.rooms {
        base.rooms.retain(|existing| {
            existing.room_id != room.room_id && existing.host_public_key != room.host_public_key
        });
        base.rooms.push(room);
    }
    base.rooms.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.room_id.cmp(&b.room_id)));
    base.rooms.truncate(MAX_ROOMS);
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
                UpdateData::State(value) => merge_state(&mut merged, parse_state(&parameters, value.as_ref())?),
                UpdateData::Delta(value) => merge_state(&mut merged, parse_state(&parameters, value.as_ref())?),
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
        value.extend_from_slice(&[2_u8; 32]);
        value.extend_from_slice(&[3_u8; 32]);
        Parameters::from(value)
    }

    fn signed_room(status: &str) -> Room {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let mut room = Room {
            version: 1,
            room_id: "room-test-1".to_owned(),
            title: "GameDeck Test Room".to_owned(),
            system_id: "snes".to_owned(),
            host_name: "Player One".to_owned(),
            max_players: 4,
            player_count: 1,
            created_at: 1_000,
            expires_at: 20_000,
            invite: "GDPLAY1.dGVzdA".to_owned(),
            status: status.to_owned(),
            host_public_key: hex::encode(signing.verifying_key().to_bytes()),
            signature: String::new(),
        };
        let (game, core) = match_hashes(&parameters()).unwrap();
        room.signature = hex::encode(signing.sign(signature_message(&room, &game, &core).as_bytes()).to_bytes());
        room
    }

    #[test]
    fn accepts_signed_room() {
        let state = RoomState { version: 1, rooms: vec![signed_room("open")] };
        let result = Contract::validate_state(
            parameters(),
            State::from(serde_json::to_vec(&state).unwrap()),
            Default::default(),
        );
        assert!(matches!(result, Ok(ValidateResult::Valid)));
    }

    #[test]
    fn rejects_tampered_room() {
        let mut room = signed_room("open");
        room.title = "Tampered".to_owned();
        let state = RoomState { version: 1, rooms: vec![room] };
        let result = Contract::validate_state(
            parameters(),
            State::from(serde_json::to_vec(&state).unwrap()),
            Default::default(),
        );
        assert!(matches!(result, Err(ContractError::InvalidState)));
    }
}
